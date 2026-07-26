import assert from 'node:assert/strict';

import type { SyncQueueItem } from '../src/types/sync.ts';

interface CleanupResult {
  queue: unknown[];
  removed: number;
  protected: number;
}

interface CleanupModule {
  clearUnprotectedDeadItems: (queue: unknown) => CleanupResult;
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

  assert.deepEqual(
    cleanup.clearUnprotectedDeadItems(null),
    { queue: [], removed: 0, protected: 0 },
    'un runtime snapshot no-array degrada de forma segura',
  );

  console.log('sync dead cleanup tests: ok');
}

void main();
