import assert from 'node:assert/strict';
import test from 'node:test';

import { collectLocalSaleOperationIds } from '../src/services/localSaleTickets.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';

function queueItem(
  id: string,
  overrides: Partial<SyncQueueItem> = {},
): SyncQueueItem {
  return {
    id,
    type: 'sale_order',
    payload: {},
    status: 'pending',
    created_at: 1_753_350_000_000,
    retries: 0,
    error_message: null,
    priority: 1,
    next_retry_at: null,
    ...overrides,
  };
}

test('collects only active sale ids in first-seen queue order without mutating input', () => {
  const queue = [
    queueItem(' sale-a '),
    queueItem('photo-a', { type: 'photo', priority: 2 }),
    queueItem('sale-done', { status: 'done' }),
    queueItem('sale-b', { status: 'syncing' }),
    queueItem('sale-c', { status: 'error' }),
    queueItem('sale-d', { status: 'dead' }),
  ];
  const original = structuredClone(queue);

  assert.deepEqual(
    collectLocalSaleOperationIds(queue),
    [' sale-a ', 'sale-b', 'sale-c', 'sale-d'],
  );
  assert.deepEqual(queue, original);
});

test('deduplicates by trimmed id while preserving the first original queue id', () => {
  const queue = [
    queueItem(' sale-a '),
    queueItem('sale-a', { status: 'error' }),
    queueItem('sale-b'),
    queueItem(' sale-b '),
  ];

  assert.deepEqual(
    collectLocalSaleOperationIds(queue),
    [' sale-a ', 'sale-b'],
  );
});

test('ignores blank ids and malformed runtime queue values without throwing', () => {
  const malformedQueue: unknown = [
    null,
    42,
    {},
    { type: 'sale_order', status: 'pending', id: 99 },
    { type: 'sale_order', id: 'missing-status' },
    { type: 'sale_order', status: 'unknown', id: 'unknown-status' },
    { type: 'sale_order', status: 'pending', id: '   ' },
    { type: 'photo', status: 'pending', id: 'photo' },
    { type: 'sale_order', status: 'pending', id: 'sale-valid' },
  ];

  assert.doesNotThrow(() => collectLocalSaleOperationIds(malformedQueue));
  assert.deepEqual(collectLocalSaleOperationIds(malformedQueue), ['sale-valid']);
  assert.deepEqual(collectLocalSaleOperationIds(null), []);
  assert.deepEqual(collectLocalSaleOperationIds({}), []);
});
