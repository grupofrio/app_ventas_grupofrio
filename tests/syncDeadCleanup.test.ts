import assert from 'node:assert/strict';

import type { SyncQueueItem } from '../src/types/sync.ts';

interface CleanupResult {
  queue: unknown[];
  removed: number;
  protected: number;
}

interface CleanupModule {
  clearUnprotectedDeadItems: (queue: unknown) => CleanupResult;
  createDeadCleanupAction: (dependencies: {
    read: () => unknown;
    transformAndPersist: (transform: (queue: unknown) => unknown[]) => Promise<void>;
  }) => () => Promise<{ removed: number; protected: number }>;
}

function item(
  id: string,
  status: SyncQueueItem['status'],
  overrides: Partial<SyncQueueItem> = {},
): SyncQueueItem {
  return {
    id,
    type: 'sale_order',
    payload: { marker: id },
    status,
    created_at: 1_000,
    retries: 3,
    error_message: 'falló',
    priority: 1,
    next_retry_at: null,
    ...overrides,
  };
}

async function main() {
  const cleanup = await import(
    // @ts-ignore -- import.meta is used only by Node's test runtime.
    new URL('../src/services/syncDeadCleanup.ts', import.meta.url).pathname
  ) as CleanupModule;

  const protectedSale = item('sale-stock', 'dead', {
    error_code: ' insufficient_STOCK ',
  });
  const ordinaryDead = item('sale-old', 'dead', { error_code: 'validation_error' });
  const live = item('sale-pending', 'pending');
  const queue = [protectedSale, ordinaryDead, live];
  const before = structuredClone(queue);

  const result = cleanup.clearUnprotectedDeadItems(queue);

  assert.deepEqual(result.queue, [protectedSale, live]);
  assert.equal(result.removed, 1);
  assert.equal(result.protected, 1);
  assert.deepEqual(queue, before, 'la limpieza no muta la cola de entrada');
  assert.equal(result.queue[0], protectedSale, 'los ítems conservados mantienen su referencia');

  const protectedRoot = item('sale-root', 'dead', {
    error_code: 'insufficient_stock',
  });
  const photo = item('photo-child', 'dead', {
    type: 'photo',
    dependsOn: ['sale-root'],
  });
  const checkout = item('checkout-grandchild', 'dead', {
    type: 'checkout',
    dependsOn: ['photo-child'],
  });
  const unrelated = item('unrelated-dead', 'dead', { type: 'photo' });
  const transitive = cleanup.clearUnprotectedDeadItems([
    checkout,
    unrelated,
    photo,
    protectedRoot,
  ]);
  assert.deepEqual(
    transitive.queue,
    [checkout, photo, protectedRoot],
    'protege transitivamente dependientes dead aunque aparezcan antes de la raíz',
  );
  assert.equal(transitive.removed, 1);
  assert.equal(transitive.protected, 1, 'protected cuenta raíces de venta, no dependientes');

  const cycleA = item('cycle-a', 'dead', {
    type: 'photo',
    dependsOn: ['sale-cycle', 'cycle-b'],
  });
  const cycleB = item('cycle-b', 'dead', {
    type: 'checkout',
    dependsOn: ['cycle-a'],
  });
  const cycleRoot = item('sale-cycle', 'dead', {
    error_code: 'insufficient_stock',
  });
  const cycle = cleanup.clearUnprotectedDeadItems([cycleB, cycleA, cycleRoot]);
  assert.deepEqual(cycle.queue, [cycleB, cycleA, cycleRoot], 'los ciclos terminan y se retienen');
  assert.equal(cycle.protected, 1);
  assert.equal(cycle.removed, 0);

  const malformedDead = new Proxy({ status: 'dead' }, {
    get(target, property, receiver) {
      if (property === 'type') throw new Error('getter hostil');
      return Reflect.get(target, property, receiver);
    },
  });
  const malformedLive = new Proxy({}, {
    get() {
      throw new Error('snapshot corrupto');
    },
  });
  const malformed = cleanup.clearUnprotectedDeadItems([
    malformedDead,
    malformedLive,
    null,
    'legacy',
  ]);
  assert.equal(malformed.removed, 1, 'un dead no clasificable no queda protegido');
  assert.equal(malformed.protected, 0);
  assert.deepEqual(
    malformed.queue.slice(1),
    [null, 'legacy'],
    'valores no-dead corruptos se conservan sin romper la limpieza',
  );
  assert.equal(malformed.queue[0], malformedLive);

  const hostileDependencies = item('hostile-dependent', 'dead', { type: 'photo' });
  Object.defineProperty(hostileDependencies, 'dependsOn', {
    get() { throw new Error('dependsOn hostil'); },
  });
  assert.doesNotThrow(() => cleanup.clearUnprotectedDeadItems([
    item('sale-safe', 'dead', { error_code: 'insufficient_stock' }),
    hostileDependencies,
  ]));

  assert.deepEqual(
    cleanup.clearUnprotectedDeadItems(null),
    { queue: [], removed: 0, protected: 0 },
    'un runtime snapshot no-array degrada de forma segura',
  );
  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  assert.doesNotThrow(
    () => cleanup.clearUnprotectedDeadItems(revoked.proxy),
    'un Proxy de cola revocado no rompe la limpieza',
  );

  let durable = [protectedSale, ordinaryDead, live] as unknown[];
  let memory = durable;
  const events: string[] = [];
  const clearDead = cleanup.createDeadCleanupAction({
    read: () => memory,
    transformAndPersist: async (transform) => {
      const durableNext = transform(memory);
      events.push('write');
      durable = durableNext;
      events.push('publish');
      memory = transform(memory);
    },
  });
  const cleared = await clearDead();
  assert.deepEqual(events, ['write', 'publish']);
  assert.deepEqual(cleared, { removed: 1, protected: 1 });
  assert.deepEqual(memory, [protectedSale, live]);
  assert.deepEqual(durable, [protectedSale, live]);

  const persistedBeforeFailure = [protectedSale, ordinaryDead];
  let memoryAfterFailure = persistedBeforeFailure;
  let processingCalls = 0;
  const failingClear = cleanup.createDeadCleanupAction({
    read: () => memoryAfterFailure,
    transformAndPersist: async () => {
      processingCalls += 1;
      throw new Error('storage unavailable');
    },
  });
  await assert.rejects(failingClear(), /storage unavailable/);
  assert.equal(memoryAfterFailure, persistedBeforeFailure, 'fallo durable no publica memoria');
  assert.equal(processingCalls, 1);

  let concurrentMemory = [protectedSale, ordinaryDead] as unknown[];
  let releaseWrite!: () => void;
  const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  let writes = 0;
  const concurrentClear = cleanup.createDeadCleanupAction({
    read: () => concurrentMemory,
    transformAndPersist: async (transform) => {
      writes += 1;
      transform(concurrentMemory);
      await writeGate;
      concurrentMemory = [...concurrentMemory, live];
      concurrentMemory = transform(concurrentMemory);
    },
  });
  const firstClear = concurrentClear();
  const secondClear = concurrentClear();
  assert.equal(firstClear, secondClear, 'dos limpiezas concurrentes comparten un vuelo');
  releaseWrite();
  await Promise.all([firstClear, secondClear]);
  assert.equal(writes, 1);
  assert.ok(concurrentMemory.includes(live), 'una adición simultánea no se pierde al publicar');

  console.log('sync dead cleanup tests: ok');
}

void main();
