import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySaleDefinitiveClearDeferral,
  gateSaleDefinitiveFailure,
} from '../src/services/saleDefinitiveFailure.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';

const sale: SyncQueueItem = {
  id: 'sale-op-1',
  type: 'sale_order',
  payload: { _operationId: 'sale-op-1' },
  status: 'syncing',
  created_at: 1,
  retries: 2,
  error_message: null,
  priority: 1,
  next_retry_at: null,
};

test('a definitive queued rejection clears matching visit state before dead handling', async () => {
  const events: string[] = [];

  const outcome = await gateSaleDefinitiveFailure({
    item: sale,
    clearMatchingVisit: async (operationId) => {
      events.push(`clear:${operationId}`);
      return true;
    },
  });
  events.push('dead');

  assert.equal(outcome, 'proceed');
  assert.deepEqual(events, ['clear:sale-op-1', 'dead']);
});

test('a failed visit clear defers the sale without spending retry budget or cascading', async () => {
  const retryAt = 9_000;
  const outcome = await gateSaleDefinitiveFailure({
    item: sale,
    clearMatchingVisit: async () => { throw new Error('visit storage failed'); },
  });
  const queue = applySaleDefinitiveClearDeferral([
    sale,
    {
      ...sale,
      id: 'photo-1',
      type: 'photo',
      priority: 2,
      status: 'pending',
      dependsOn: [sale.id],
    },
  ], sale.id, retryAt);

  assert.equal(outcome, 'deferred');
  assert.equal(queue[0].status, 'error');
  assert.equal(queue[0].retries, 0);
  assert.equal(queue[0].next_retry_at, retryAt);
  assert.equal(queue[1].status, 'pending');
});

test('a nonmatching visit does not block definitive dead handling', async () => {
  const outcome = await gateSaleDefinitiveFailure({
    item: sale,
    clearMatchingVisit: async () => false,
  });

  assert.equal(outcome, 'proceed');
});
