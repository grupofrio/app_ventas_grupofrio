import assert from 'node:assert/strict';
import test from 'node:test';

import { createSerializedTaskRunner } from '../src/services/serializedTaskRunner.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
