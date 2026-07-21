import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSerializedPersistenceCoordinator,
  createSerializedTaskRunner,
} from '../src/services/serializedTaskRunner.ts';
import { selectPersistableQueue } from '../src/services/syncQueuePersistence.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface TestQueueItem {
  id: string;
  status: 'pending' | 'syncing' | 'done' | 'error';
  payload: Record<string, unknown>;
}

function cloneQueue(queue: TestQueueItem[]): TestQueueItem[] {
  return queue.map((item) => ({ ...item, payload: { ...item.payload } }));
}

function createQueueHarness(
  initial: TestQueueItem[],
  write?: (snapshot: TestQueueItem[], index: number) => Promise<void>,
) {
  let memory = cloneQueue(initial);
  let storage = cloneQueue(selectPersistableQueue(initial));
  const writes: TestQueueItem[][] = [];
  const coordinator = createSerializedPersistenceCoordinator<TestQueueItem[], TestQueueItem[]>({
    read: () => memory,
    select: selectPersistableQueue,
    write: async (snapshot) => {
      const captured = cloneQueue(snapshot);
      const index = writes.push(captured) - 1;
      await write?.(captured, index);
      storage = captured;
    },
    publish: (next) => {
      memory = next;
    },
  });

  return {
    coordinator,
    getMemory: () => cloneQueue(memory),
    setMemory: (next: TestQueueItem[]) => { memory = cloneQueue(next); },
    getStorage: () => cloneQueue(storage),
    writes,
  };
}

function markLegacyConsumed(queue: TestQueueItem[]): TestQueueItem[] {
  return queue.map((item) =>
    item.id === 'legacy'
      ? { ...item, payload: { ...item.payload, _legacyStockRestored: true } }
      : item,
  );
}

function removeLegacy(queue: TestQueueItem[]): TestQueueItem[] {
  return queue.filter((item) => item.id !== 'legacy');
}

test('task 2 does not start until blocked task 1 finishes', async () => {
  const runSerialized = createSerializedTaskRunner();
  const task1Gate = deferred<void>();
  const task1Started = deferred<void>();
  const starts: number[] = [];

  const task1 = runSerialized(async () => {
    starts.push(1);
    task1Started.resolve();
    await task1Gate.promise;
    return 'one';
  });
  const task2 = runSerialized(async () => {
    starts.push(2);
    return 'two';
  });

  await task1Started.promise;
  assert.deepEqual(starts, [1]);

  task1Gate.resolve();
  assert.equal(await task1, 'one');
  assert.equal(await task2, 'two');
  assert.deepEqual(starts, [1, 2]);
});

test('task 2 reads state when it executes instead of when it is requested', async () => {
  const runSerialized = createSerializedTaskRunner();
  const task1Gate = deferred<void>();
  const task1Started = deferred<void>();
  let state = 'before-request';

  const task1 = runSerialized(async () => {
    task1Started.resolve();
    await task1Gate.promise;
  });
  const task2 = runSerialized(async () => state);

  await task1Started.promise;
  state = 'after-request';
  task1Gate.resolve();

  await task1;
  assert.equal(await task2, 'after-request');
});

test('a rejected task rejects its promise without blocking the next task', async () => {
  const runSerialized = createSerializedTaskRunner();
  const task1Gate = deferred<void>();
  const task1Started = deferred<void>();
  const task2Started = deferred<void>();
  const failure = new Error('task 1 failed');

  const task1 = runSerialized(async () => {
    task1Started.resolve();
    await task1Gate.promise;
  });
  const task1Rejection = assert.rejects(task1, failure);
  const task2 = runSerialized(async () => {
    task2Started.resolve();
    return 'task 2 completed';
  });

  await task1Started.promise;
  task1Gate.reject(failure);

  await task1Rejection;
  await task2Started.promise;
  assert.equal(await task2, 'task 2 completed');
});

test('a synchronous task throw rejects its promise without blocking the next task', async () => {
  const runSerialized = createSerializedTaskRunner();
  const failure = new Error('synchronous task failure');

  const rejected = runSerialized(() => {
    throw failure;
  });
  const next = runSerialized(async () => 'continued');

  await assert.rejects(rejected, failure);
  assert.equal(await next, 'continued');
});

test('tasks finish in request order', async () => {
  const runSerialized = createSerializedTaskRunner();
  const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
  const starts = [deferred<void>(), deferred<void>(), deferred<void>()];
  const completions: number[] = [];

  const tasks = gates.map((gate, index) =>
    runSerialized(async () => {
      starts[index].resolve();
      await gate.promise;
      completions.push(index + 1);
      return index + 1;
    }),
  );

  await starts[0].promise;
  gates[0].resolve();
  await starts[1].promise;
  gates[1].resolve();
  await starts[2].promise;
  gates[2].resolve();

  assert.deepEqual(await Promise.all(tasks), [1, 2, 3]);
  assert.deepEqual(completions, [1, 2, 3]);
});

test('queue persistence is FIFO and reads each snapshot when its turn starts', async () => {
  const gates = [deferred<void>(), deferred<void>()];
  const starts = [deferred<void>(), deferred<void>()];
  const initial: TestQueueItem[] = [
    { id: 'first-snapshot', status: 'pending', payload: {} },
  ];
  const harness = createQueueHarness(initial, async (_snapshot, index) => {
    starts[index].resolve();
    await gates[index].promise;
  });

  const first = harness.coordinator.persistCurrent();
  await starts[0].promise;
  const second = harness.coordinator.persistCurrent();
  harness.setMemory([{ id: 'second-snapshot', status: 'syncing', payload: {} }]);

  assert.deepEqual(harness.writes.map((write) => write.map((item) => item.id)), [
    ['first-snapshot'],
  ]);
  gates[0].resolve();
  await first;
  await starts[1].promise;
  assert.deepEqual(harness.writes.map((write) => write.map((item) => item.id)), [
    ['first-snapshot'],
    ['second-snapshot'],
  ]);
  gates[1].resolve();
  await second;
});

test('a storage rejection does not block the next queue write', async () => {
  const starts = [deferred<void>(), deferred<void>()];
  const firstGate = deferred<void>();
  const secondGate = deferred<void>();
  const failure = new Error('storage unavailable');
  const harness = createQueueHarness(
    [{ id: 'first', status: 'pending', payload: {} }],
    async (_snapshot, index) => {
      starts[index].resolve();
      if (index === 0) await firstGate.promise;
      await secondGate.promise;
    },
  );

  const first = harness.coordinator.persistCurrent();
  const firstRejection = assert.rejects(first, failure);
  await starts[0].promise;
  harness.setMemory([{ id: 'second', status: 'pending', payload: {} }]);
  const second = harness.coordinator.persistCurrent();
  firstGate.reject(failure);

  await firstRejection;
  await starts[1].promise;
  secondGate.resolve();
  await second;
  assert.deepEqual(harness.getStorage().map((item) => item.id), ['second']);
});

test('a public persistence barrier waits behind a writer already in flight', async () => {
  const gates = [deferred<void>(), deferred<void>()];
  const starts = [deferred<void>(), deferred<void>()];
  const harness = createQueueHarness(
    [{ id: 'queued', status: 'pending', payload: {} }],
    async (_snapshot, index) => {
      starts[index].resolve();
      await gates[index].promise;
    },
  );

  const writer = harness.coordinator.persistCurrent();
  await starts[0].promise;
  const barrier = harness.coordinator.persistCurrent();
  let barrierSettled = false;
  void barrier.then(() => { barrierSettled = true; });

  await Promise.resolve();
  assert.equal(barrierSettled, false);
  assert.equal(harness.writes.length, 1);

  gates[0].resolve();
  await writer;
  await starts[1].promise;
  assert.equal(barrierSettled, false);
  gates[1].resolve();
  await barrier;
  assert.equal(barrierSettled, true);
});

test('mark phase preserves a concurrent addition in memory and the next durable snapshot', async () => {
  const markWriteGate = deferred<void>();
  const markWriteStarted = deferred<void>();
  const initial: TestQueueItem[] = [
    { id: 'legacy', status: 'pending', payload: {} },
    { id: 'kept', status: 'pending', payload: {} },
  ];
  const harness = createQueueHarness(initial, async (_snapshot, index) => {
    if (index === 0) {
      markWriteStarted.resolve();
      await markWriteGate.promise;
    }
  });

  const marking = harness.coordinator.transformAndPersist(markLegacyConsumed);
  await markWriteStarted.promise;
  harness.setMemory([
    ...harness.getMemory().map((item) =>
      item.id === 'kept'
        ? { ...item, status: 'syncing' as const, payload: { changedDuringWrite: true } }
        : item,
    ),
    { id: 'concurrent', status: 'pending', payload: {} },
  ]);
  const concurrentPersistence = harness.coordinator.persistCurrent();

  markWriteGate.resolve();
  await marking;
  await concurrentPersistence;

  assert.deepEqual(harness.getMemory(), [
    { id: 'legacy', status: 'pending', payload: { _legacyStockRestored: true } },
    { id: 'kept', status: 'syncing', payload: { changedDuringWrite: true } },
    { id: 'concurrent', status: 'pending', payload: {} },
  ]);
  assert.deepEqual(harness.getStorage(), harness.getMemory());
  assert.deepEqual(harness.writes[0].map((item) => item.id), ['legacy', 'kept']);
  assert.deepEqual(harness.writes[1].map((item) => item.id), ['legacy', 'kept', 'concurrent']);
});

test('remove phase preserves a concurrent addition in memory and the next durable snapshot', async () => {
  const removeWriteGate = deferred<void>();
  const removeWriteStarted = deferred<void>();
  const initial: TestQueueItem[] = [
    { id: 'legacy', status: 'pending', payload: { _legacyStockRestored: true } },
    { id: 'kept', status: 'pending', payload: {} },
  ];
  const harness = createQueueHarness(initial, async (_snapshot, index) => {
    if (index === 0) {
      removeWriteStarted.resolve();
      await removeWriteGate.promise;
    }
  });

  const removing = harness.coordinator.transformAndPersist(removeLegacy);
  await removeWriteStarted.promise;
  harness.setMemory([
    ...harness.getMemory().map((item) =>
      item.id === 'kept'
        ? { ...item, status: 'syncing' as const, payload: { changedDuringWrite: true } }
        : item,
    ),
    { id: 'concurrent', status: 'pending', payload: {} },
  ]);
  const concurrentPersistence = harness.coordinator.persistCurrent();

  removeWriteGate.resolve();
  await removing;
  await concurrentPersistence;

  assert.deepEqual(harness.getMemory(), [
    { id: 'kept', status: 'syncing', payload: { changedDuringWrite: true } },
    { id: 'concurrent', status: 'pending', payload: {} },
  ]);
  assert.deepEqual(harness.getStorage(), harness.getMemory());
  assert.deepEqual(harness.writes[0].map((item) => item.id), ['kept']);
  assert.deepEqual(harness.writes[1].map((item) => item.id), ['kept', 'concurrent']);
});

test('mark storage rejection publishes neither the mark nor a durable snapshot', async () => {
  const failure = new Error('mark write failed');
  const initial: TestQueueItem[] = [
    { id: 'legacy', status: 'pending', payload: {} },
    { id: 'kept', status: 'pending', payload: {} },
  ];
  const harness = createQueueHarness(initial, async () => { throw failure; });

  await assert.rejects(
    harness.coordinator.transformAndPersist(markLegacyConsumed),
    failure,
  );
  assert.deepEqual(harness.getMemory(), initial);
  assert.deepEqual(harness.getStorage(), initial);
});

test('remove storage rejection keeps the durable and in-memory marked legacy item', async () => {
  const failure = new Error('remove write failed');
  const initial: TestQueueItem[] = [
    { id: 'legacy', status: 'pending', payload: { _legacyStockRestored: true } },
    { id: 'kept', status: 'pending', payload: {} },
  ];
  const harness = createQueueHarness(initial, async () => { throw failure; });

  await assert.rejects(
    harness.coordinator.transformAndPersist(removeLegacy),
    failure,
  );
  assert.deepEqual(harness.getMemory(), initial);
  assert.deepEqual(harness.getStorage(), initial);
});

test('queue snapshots filter done items while retaining syncing items', async () => {
  const harness = createQueueHarness([
    { id: 'done', status: 'done', payload: {} },
    { id: 'syncing', status: 'syncing', payload: {} },
    { id: 'pending', status: 'pending', payload: {} },
  ]);

  await harness.coordinator.persistCurrent();

  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.writes[0].map((item) => [item.id, item.status]), [
    ['syncing', 'syncing'],
    ['pending', 'pending'],
  ]);
  assert.deepEqual(harness.getMemory().map((item) => item.id), ['done', 'syncing', 'pending']);
});
