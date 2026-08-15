import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requiresSyncReconciliation,
  shouldRetrySyncItemError,
  toManualReconciliationItem,
  transitionAgedItemsToManualReconciliation,
} from '../src/services/syncRetryDecision.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';

function withMeta<T extends Record<string, unknown>>(metadata: T): Error & T {
  return Object.assign(new Error('structured sync failure'), metadata);
}

const cases = [
  {
    name: 'retries a sale with an invalid response',
    type: 'sale_order' as const,
    error: withMeta({ code: 'invalid_response' }),
    expected: true,
  },
  {
    name: 'retries a sale with an unknown error',
    type: 'sale_order' as const,
    error: new Error('unknown'),
    expected: true,
  },
  {
    name: 'retries a sale after HTTP 503',
    type: 'sale_order' as const,
    error: withMeta({ httpStatus: 503 }),
    expected: true,
  },
  {
    name: 'does not retry a sale rejected for insufficient stock',
    type: 'sale_order' as const,
    error: withMeta({ code: 'insufficient_stock' }),
    expected: false,
  },
  {
    name: 'does not retry a sale rejected with HTTP 422',
    type: 'sale_order' as const,
    error: withMeta({ httpStatus: 422 }),
    expected: false,
  },
  {
    name: 'retries a photo after a network failure',
    type: 'photo' as const,
    error: new Error('Network request failed'),
    expected: true,
  },
  {
    name: 'does not retry a photo after an unknown error',
    type: 'photo' as const,
    error: new Error('unknown'),
    expected: false,
  },
];

for (const testCase of cases) {
  test(testCase.name, () => {
    assert.equal(shouldRetrySyncItemError(testCase.type, testCase.error), testCase.expected);
  });
}

function makeQueuedItem(createdAt: number): SyncQueueItem {
  return {
    id: 'queued-operation',
    type: 'checkout',
    payload: { operation_id: 'c3aa411f-8e51-47b8-91d8-2690b64feab2' },
    status: 'pending',
    created_at: createdAt,
    retries: 0,
    error_message: null,
    priority: 1,
    next_retry_at: null,
  };
}

test('requires manual reconciliation for an operation at the ninety-day retry boundary', () => {
  const now = Date.UTC(2026, 7, 14);
  const ninetyDaysAgo = now - (90 * 24 * 60 * 60 * 1000);

  assert.equal(requiresSyncReconciliation(makeQueuedItem(ninetyDaysAgo), now), true);
});

test('keeps a younger operation eligible for automatic retry', () => {
  const now = Date.UTC(2026, 7, 14);
  const justInsideAutomaticWindow = now - (90 * 24 * 60 * 60 * 1000) + 1;

  assert.equal(requiresSyncReconciliation(makeQueuedItem(justInsideAutomaticWindow), now), false);
});

test('preserves an aged operation for manual reconciliation without a retry schedule', () => {
  const original = makeQueuedItem(Date.UTC(2026, 4, 15));
  const reconciled = toManualReconciliationItem(original);

  assert.notStrictEqual(reconciled, original);
  assert.equal(reconciled.id, original.id);
  assert.deepEqual(reconciled.payload, original.payload);
  assert.equal(reconciled.status, 'dead');
  assert.equal(reconciled.next_retry_at, null);
  assert.match(reconciled.error_message ?? '', /reconciliación manual/i);
});

test('transitions only aged queue operations without deleting or resending them', () => {
  const now = Date.UTC(2026, 7, 14);
  const aged = makeQueuedItem(now - (90 * 24 * 60 * 60 * 1000));
  const younger = { ...makeQueuedItem(now - 1), id: 'recent-operation' };

  const queue = transitionAgedItemsToManualReconciliation([aged, younger], now);

  assert.equal(queue.length, 2);
  assert.equal(queue[0].status, 'dead');
  assert.equal(queue[0].id, aged.id);
  assert.deepEqual(queue[0].payload, aged.payload);
  assert.equal(queue[1], younger);
});
