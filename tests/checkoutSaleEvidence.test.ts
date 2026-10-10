/**
 * F41 — a rejected offline sale, or a gift, must not check out as "sale"
 * and must not be presented as "Venta realizada".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCheckoutResultStatus } from '../src/services/checkoutResult.ts';
import {
  checkoutResultSaleTotal,
  describeCheckoutSalePresentation,
  hasSyncedSaleForStop,
  isMissingDeliveryLinesCheckoutError,
  resolveCheckoutResultStatus,
  retryCheckoutAsNoSale,
  shouldDiscardRejectedSaleCart,
  syncedSaleAmountForStop,
} from '../src/services/checkoutSaleEvidence.ts';
import { stuckVisitSaleTotal } from '../src/services/stuckVisitClose.ts';

const DELIVERY_LINE_ERROR = 'Debes capturar al menos una línea de entrega para ese resultado.';
const STOP_ID = 220969;
const OTHER_STOP = 221167;

test('a gift and a rejected offline sale are not a synced sale', () => {
  const rejected = {
    id: 'sale-rejected',
    type: 'sale_order',
    status: 'dead',
    payload: { stop_id: STOP_ID, _clientTotal: 342 },
  };
  const gift = {
    stop_id: STOP_ID,
    is_gift: true,
    amount_total: 0,
    lines: [{ discount: 100, price_subtotal: 0 }],
  };
  assert.equal(hasSyncedSaleForStop(STOP_ID, [rejected], [gift]), false);
  assert.equal(syncedSaleAmountForStop(STOP_ID, [rejected], [gift]), null);

  const saleTotal = checkoutResultSaleTotal(
    false,
    stuckVisitSaleTotal({
      currentStopId: OTHER_STOP,
      stopId: STOP_ID,
      visitSaleTotal: 342,
      hasSyncedSale: false,
    }),
  );
  assert.equal(saleTotal, 0);
  assert.equal(getCheckoutResultStatus({ saleTotal, noSaleReasonId: null }), 'no_sale');
  assert.equal(resolveCheckoutResultStatus(false), 'no_sale');
  assert.deepEqual(describeCheckoutSalePresentation({
    hasSyncedSale: false,
    saleSyncStatus: 'failed',
    cartTotal: 342,
  }), { kind: 'none' });
  assert.deepEqual(describeCheckoutSalePresentation({
    hasSyncedSale: false,
    saleSyncStatus: 'none',
    cartTotal: 342,
  }), { kind: 'none' });
});

test('a server-accepted sale checks out as sale even when the cart is empty', () => {
  const done = {
    id: 'sale-done',
    type: 'sale_order',
    status: 'done',
    payload: { stop_id: STOP_ID, _clientTotal: 342 },
  };
  const remote = {
    stop_id: STOP_ID,
    is_gift: false,
    amount_total: 342,
    lines: [{ product_id: 5, qty: 9 }],
  };
  assert.equal(hasSyncedSaleForStop(STOP_ID, [done], []), true);
  assert.equal(hasSyncedSaleForStop(STOP_ID, [], [remote]), true);
  assert.equal(syncedSaleAmountForStop(STOP_ID, [], [remote]), 342);
  assert.equal(checkoutResultSaleTotal(true, 0), 1);
  assert.equal(resolveCheckoutResultStatus(true), 'sale');
  assert.equal(
    getCheckoutResultStatus({ saleTotal: checkoutResultSaleTotal(true, 342), noSaleReasonId: null }),
    'sale',
  );
  assert.deepEqual(describeCheckoutSalePresentation({
    hasSyncedSale: true,
    saleSyncStatus: 'done',
    cartTotal: 0,
    syncedAmount: 342,
  }), { kind: 'synced', amount: 342 });
});

test('a still-pending sale is not presented as realized and does not count as synced', () => {
  const pending = {
    id: 'sale-pending',
    type: 'sale_order',
    status: 'pending',
    payload: { stop_id: STOP_ID, _clientTotal: 342 },
  };
  assert.equal(hasSyncedSaleForStop(STOP_ID, [pending], []), false);
  assert.equal(resolveCheckoutResultStatus(false), 'no_sale');
  assert.deepEqual(describeCheckoutSalePresentation({
    hasSyncedSale: false,
    saleSyncStatus: 'pending',
    cartTotal: 342,
  }), { kind: 'pending', amount: 342 });
});

test('a queued gift is not a delivery sale', () => {
  const giftQueue = {
    id: 'gift-as-sale',
    type: 'sale_order',
    status: 'done',
    payload: { stop_id: STOP_ID, is_gift: true, _clientTotal: 0 },
  };
  const giftType = {
    id: 'gift',
    type: 'gift',
    status: 'done',
    payload: { stop_id: STOP_ID },
  };
  assert.equal(hasSyncedSaleForStop(STOP_ID, [giftQueue, giftType], []), false);
});

test('missing delivery lines retries once as no_sale', async () => {
  assert.equal(isMissingDeliveryLinesCheckoutError(DELIVERY_LINE_ERROR), true);
  assert.equal(isMissingDeliveryLinesCheckoutError('Stock insuficiente'), false);

  let calls = 0;
  const recovered = await retryCheckoutAsNoSale(
    new Error(DELIVERY_LINE_ERROR),
    'sale',
    async () => { calls += 1; },
  );
  assert.equal(recovered, true);
  assert.equal(calls, 1);

  const skipped = await retryCheckoutAsNoSale(
    new Error(DELIVERY_LINE_ERROR),
    'no_sale',
    async () => { calls += 1; },
  );
  assert.equal(skipped, false);
  assert.equal(calls, 1);

  const other = await retryCheckoutAsNoSale(
    new Error('otro error'),
    'sale',
    async () => { calls += 1; },
  );
  assert.equal(other, false);
  assert.equal(calls, 1);
});

test('a rejected sale cart is discarded for that operation or the same stop', () => {
  assert.equal(shouldDiscardRejectedSaleCart({
    saleOperationId: 'sale-rejected',
    currentStopId: OTHER_STOP,
    saleLineCount: 1,
    rejectedOperationId: 'sale-rejected',
    rejectedStopId: STOP_ID,
  }), true);
  assert.equal(shouldDiscardRejectedSaleCart({
    saleOperationId: null,
    currentStopId: STOP_ID,
    saleLineCount: 1,
    rejectedOperationId: 'sale-rejected',
    rejectedStopId: STOP_ID,
  }), true);
  assert.equal(shouldDiscardRejectedSaleCart({
    saleOperationId: null,
    currentStopId: OTHER_STOP,
    saleLineCount: 1,
    rejectedOperationId: 'sale-rejected',
    rejectedStopId: STOP_ID,
  }), false);
  assert.equal(shouldDiscardRejectedSaleCart({
    saleOperationId: 'other',
    currentStopId: STOP_ID,
    saleLineCount: 1,
    rejectedOperationId: 'sale-rejected',
    rejectedStopId: STOP_ID,
  }), false);
});

test('checkout, stuck close, and liquidation only send sale with synced evidence', () => {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
  const checkout = read('app/checkout/[stopId].tsx');
  const stop = read('app/stop/[stopId].tsx');
  const liquidation = read('src/services/closeInProgressStops.ts');
  const sync = read('src/stores/useSyncStore.ts');
  const visit = read('src/stores/useVisitStore.ts');

  for (const source of [checkout, stop, liquidation]) {
    assert.match(source, /hasSyncedSaleForStop/);
    assert.match(source, /retryCheckoutAsNoSale/);
    assert.match(source, /checkoutResultSaleTotal/);
  }
  assert.match(checkout, /salePresentation\.kind === 'synced'/);
  assert.match(checkout, /Venta pendiente/);
  assert.match(sync, /resolveCheckoutResultStatus\(hasSyncedSaleForStop/);
  assert.match(sync, /discardRejectedSaleCart/);
  assert.match(visit, /saleLines: \[\]/);
  const realizedAt = checkout.indexOf("'Venta realizada'");
  const syncedGuardAt = checkout.indexOf("salePresentation.kind === 'synced'");
  assert.ok(syncedGuardAt >= 0 && realizedAt > syncedGuardAt);
});
