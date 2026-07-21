import assert from 'node:assert/strict';
import type { SyncEnqueueOptions, SyncQueueItem, SyncItemType } from '../src/types/sync';

interface SyncEnqueueModule {
  applySyncEnqueue: (input: {
    queue: SyncQueueItem[];
    type: SyncItemType;
    payload: Record<string, unknown>;
    options?: SyncEnqueueOptions;
    generatedId: string;
    createdAt: number;
  }) => {
    id: string;
    queue: SyncQueueItem[];
    action: 'inserted' | 'reused' | 'rearmed_dead';
  };
}

function makeItem(
  partial: Partial<SyncQueueItem> & Pick<SyncQueueItem, 'id' | 'type' | 'status'>,
): SyncQueueItem {
  return {
    id: partial.id,
    type: partial.type,
    payload: partial.payload ?? { original: partial.id },
    status: partial.status,
    created_at: partial.created_at ?? 1_000,
    retries: partial.retries ?? 0,
    error_message: partial.error_message ?? null,
    priority: partial.priority ?? (partial.type === 'gps' ? 3 : 1),
    next_retry_at: partial.next_retry_at ?? null,
    dependsOn: partial.dependsOn,
    meta: partial.meta,
  };
}

function insert(
  m: SyncEnqueueModule,
  overrides: Partial<Parameters<SyncEnqueueModule['applySyncEnqueue']>[0]> = {},
) {
  return m.applySyncEnqueue({
    queue: [],
    type: 'sale_order',
    payload: { amount: 25 },
    generatedId: 'generated-uuid',
    createdAt: 12_345,
    ...overrides,
  });
}

function testUsesInjectedGeneratedIdWithoutExplicitId(m: SyncEnqueueModule) {
  const result = insert(m);
  assert.equal(result.id, 'generated-uuid');
  assert.equal(result.action, 'inserted');
  assert.equal(result.queue.length, 1);
  assert.equal(result.queue[0].id, 'generated-uuid');
  assert.equal(result.queue[0].payload._operationId, 'generated-uuid');
  assert.equal(result.queue[0].created_at, 12_345);
}

function testNormalizesExplicitIdAndCallerCannotOverwriteIt(m: SyncEnqueueModule) {
  const result = insert(m, {
    options: { operationId: '  durable-sale-1  ' },
    payload: { amount: 25, _operationId: 'caller-value' },
  });
  assert.equal(result.id, 'durable-sale-1');
  assert.equal(result.queue[0].id, 'durable-sale-1');
  assert.equal(result.queue[0].payload._operationId, 'durable-sale-1');
  assert.equal(result.queue[0].payload.amount, 25);
}

function testReusesEveryLiveOrTerminalNonDeadState(m: SyncEnqueueModule) {
  for (const status of ['pending', 'syncing', 'error', 'done'] as const) {
    const payload = { original: status, _operationId: 'op-1' };
    const existing = makeItem({
      id: 'op-1',
      type: 'sale_order',
      status,
      payload,
      retries: status === 'error' ? 2 : 0,
      error_message: status === 'error' ? 'keep me' : null,
      next_retry_at: status === 'error' ? 88_000 : null,
    });
    const queue = [existing];
    const result = insert(m, {
      queue,
      options: { operationId: ' op-1 ' },
      payload: { replacement: true },
    });
    assert.equal(result.action, 'reused', `${status}: action`);
    assert.equal(result.queue, queue, `${status}: original queue reference`);
    assert.equal(result.queue[0], existing, `${status}: original item reference`);
    assert.equal(result.queue[0].payload, payload, `${status}: original payload reference`);
  }
}

function testRearmsOnlyMatchingDeadItemWithoutReplacingPayload(m: SyncEnqueueModule) {
  const payload = { original: true, _operationId: 'op-dead' };
  const untouched = makeItem({ id: 'other', type: 'photo', status: 'error' });
  const dead = makeItem({
    id: 'op-dead',
    type: 'sale_order',
    status: 'dead',
    payload,
    retries: 3,
    error_message: 'permanent failure',
    next_retry_at: 99_000,
  });
  const queue = [untouched, dead];
  const result = insert(m, {
    queue,
    options: { operationId: 'op-dead' },
    payload: { replacement: true },
  });
  assert.equal(result.action, 'rearmed_dead');
  assert.notEqual(result.queue, queue);
  assert.equal(result.queue[0], untouched, 'other items stay untouched');
  assert.notEqual(result.queue[1], dead);
  assert.equal(result.queue[1].payload, payload, 'original durable payload is preserved');
  assert.equal(result.queue[1].status, 'pending');
  assert.equal(result.queue[1].retries, 0);
  assert.equal(result.queue[1].error_message, null);
  assert.equal(result.queue[1].next_retry_at, null);
}

function testRejectsExplicitIdCollisionAcrossTypes(m: SyncEnqueueModule) {
  const queue = [makeItem({ id: 'shared-id', type: 'photo', status: 'pending' })];
  assert.throws(
    () => insert(m, { queue, options: { operationId: 'shared-id' } }),
    /collision|colisi[oó]n/i,
  );
  assert.equal(queue[0].type, 'photo', 'collision does not mutate the queue');
}

function testRejectsInvalidExplicitIdsWithoutUuidFallback(m: SyncEnqueueModule) {
  for (const operationId of ['', '   ', 123, null] as unknown[]) {
    assert.throws(
      () => insert(m, {
        options: { operationId } as unknown as SyncEnqueueOptions,
        generatedId: 'must-not-be-used',
      }),
      /operationId/i,
      `reject ${String(operationId)}`,
    );
  }
}

function testCopiesDependsOnInsteadOfAliasingCallerArray(m: SyncEnqueueModule) {
  const dependsOn = ['sale-1'];
  const result = insert(m, { options: { dependsOn } });
  assert.deepEqual(result.queue[0].dependsOn, ['sale-1']);
  assert.notEqual(result.queue[0].dependsOn, dependsOn);
  dependsOn.push('sale-2');
  assert.deepEqual(result.queue[0].dependsOn, ['sale-1']);
}

function testExistingExplicitGpsIsReusedBeforeCapEviction(m: SyncEnqueueModule) {
  const originalPayload = { latitude: 1, longitude: 2, _operationId: 'gps-1' };
  const queue = [makeItem({
    id: 'gps-1',
    type: 'gps',
    status: 'pending',
    payload: originalPayload,
  })];
  let evictionCalls = 0;

  // Pure model of the store orchestration: idempotency is resolved before the
  // GPS cap is consulted, and only a true insertion may invoke eviction.
  const first = m.applySyncEnqueue({
    queue,
    type: 'gps',
    payload: { latitude: 99, longitude: 99 },
    options: { operationId: 'gps-1' },
    generatedId: 'unused-generated-id',
    createdAt: 22_000,
  });
  if (first.action === 'inserted') evictionCalls++;

  assert.equal(first.action, 'reused');
  assert.equal(first.queue, queue);
  assert.equal(first.queue[0].payload, originalPayload);
  assert.equal(evictionCalls, 0, 'GPS cap must not run for explicit reuse');
}

async function main() {
  const module = await import(
    // @ts-ignore -- import.meta is only used by the Node test runtime.
    new URL('../src/services/syncEnqueue.ts', import.meta.url).pathname
  ) as SyncEnqueueModule;

  testUsesInjectedGeneratedIdWithoutExplicitId(module);
  testNormalizesExplicitIdAndCallerCannotOverwriteIt(module);
  testReusesEveryLiveOrTerminalNonDeadState(module);
  testRearmsOnlyMatchingDeadItemWithoutReplacingPayload(module);
  testRejectsExplicitIdCollisionAcrossTypes(module);
  testRejectsInvalidExplicitIdsWithoutUuidFallback(module);
  testCopiesDependsOnInsteadOfAliasingCallerArray(module);
  testExistingExplicitGpsIsReusedBeforeCapEviction(module);

  console.log('sync enqueue tests: ok');
}

void main();
