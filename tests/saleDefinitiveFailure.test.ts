import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySaleDefinitiveClearDeferral,
  gateSaleDefinitiveFailure,
  SALE_DEFINITIVE_CLEAR_DEFERRED_MESSAGE,
} from '../src/services/saleDefinitiveFailure.ts';
import { rearmSaleOrderForRetry } from '../src/services/saleRetry.ts';
import { excludeProtectedStockSyncItems } from '../src/services/syncErrorClassification.ts';
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
    failureCode: 'validation_error',
    clearMatchingVisit: async (operationId) => {
      events.push(`clear:${operationId}`);
      return true;
    },
  });
  events.push('dead');

  assert.equal(outcome, 'proceed');
  assert.deepEqual(events, ['clear:sale-op-1', 'dead']);
});

test('an insufficient-stock classification preserves the visit lock for retry with the same id', async () => {
  let visitOperationId: string | null = sale.id;
  let clearCalls = 0;

  const outcome = await gateSaleDefinitiveFailure({
    item: sale,
    failureCode: 'insufficient_stock',
    clearMatchingVisit: async () => {
      clearCalls += 1;
      visitOperationId = null;
      return true;
    },
  });
  const restartedQueue: SyncQueueItem[] = [{
    ...sale,
    status: 'dead',
    error_code: 'insufficient_stock',
  }];
  const retried = rearmSaleOrderForRetry(
    restartedQueue,
    visitOperationId ?? '',
  );

  assert.equal(outcome, 'proceed');
  assert.equal(clearCalls, 0, 'el rechazo protegido no intenta limpiar la visita');
  assert.equal(visitOperationId, sale.id, 'el operation id sobrevive para Checkout');
  assert.equal(retried[0].id, sale.id);
  assert.equal(retried[0].status, 'pending', 'retry rearma la misma operación persistida');
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
  assert.equal(queue[0].error_message, SALE_DEFINITIVE_CLEAR_DEFERRED_MESSAGE);
  assert.equal(queue[1].status, 'pending');
});

test('a failed protected stock clear preserves human detail and cannot auto retry', async () => {
  const retryAt = 12_000;
  const humanMessage = 'Hielo 5 kg: pediste 4, disponible 1';
  const protectedSale: SyncQueueItem = {
    ...sale,
    status: 'dead',
    error_message: humanMessage,
    error_code: 'insufficient_stock',
  };

  const outcome = await gateSaleDefinitiveFailure({
    item: protectedSale,
    clearMatchingVisit: async () => { throw new Error('visit storage failed'); },
  });

  const [deferred] = applySaleDefinitiveClearDeferral(
    [protectedSale],
    protectedSale.id,
    retryAt,
  );

  assert.equal(outcome, 'deferred');
  assert.equal(deferred.status, 'error');
  assert.equal(deferred.retries, 0);
  assert.equal(deferred.next_retry_at, retryAt);
  assert.equal(deferred.error_message, humanMessage);
  assert.equal(deferred.error_code, 'insufficient_stock');
  assert.deepEqual(excludeProtectedStockSyncItems([deferred]), []);
});

test('a nonmatching visit does not block definitive dead handling', async () => {
  const outcome = await gateSaleDefinitiveFailure({
    item: sale,
    clearMatchingVisit: async () => false,
  });

  assert.equal(outcome, 'proceed');
});
