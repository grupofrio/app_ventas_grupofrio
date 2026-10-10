import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findDuplicateGift,
  rememberConfirmedGift,
  resetSessionGiftsForTests,
  sessionGiftCandidates,
} from '../src/services/giftDuplicate.ts';
import {
  buildCheckinRequestBody,
  capturedGpsBatchBody,
  withCheckoutCapturedAt,
} from '../src/services/visitCapturePayload.ts';
import { shouldOfferStuckVisitClose, stuckVisitSaleTotal } from '../src/services/stuckVisitClose.ts';
import { formatOdooUtcAsMexico } from '../src/utils/localDate.ts';
import {
  readEmployeePriceAmount,
  readEmployeePriceProductId,
} from '../src/services/employeePriceRow.ts';

test('a gift confirmed online is remembered for the duplicate warning', () => {
  resetSessionGiftsForTests();
  rememberConfirmedGift({
    partnerId: 15,
    productIds: [9],
    createdAtMs: Date.parse('2026-10-09T20:21:00Z'),
  });
  assert.equal(findDuplicateGift({
    partnerId: 15,
    productIds: [9],
    nowMs: Date.parse('2026-10-09T21:00:00Z'),
    existing: sessionGiftCandidates(),
  }), true);
  resetSessionGiftsForTests();
});

test('offline check-in body keeps the captured instant and coordinates', () => {
  const body = buildCheckinRequestBody({
    stopId: 220969,
    latitude: 20.7225,
    longitude: -103.38307,
    capturedAt: '2026-10-10T02:39:00.000Z',
  });
  assert.equal(body.stop_id, 220969);
  assert.equal(body.latitude, 20.7225);
  assert.equal(body.longitude, -103.38307);
  assert.equal(body.client_checkin_at, '2026-10-10T02:39:00.000Z');

  const gps = capturedGpsBatchBody({
    latitude: 20.7225,
    longitude: -103.38307,
    timestamp: Date.parse('2026-10-10T02:39:00.000Z'),
  });
  assert.equal(gps?.records[0]?.timestamp, '2026-10-10T02:39:00.000Z');
  assert.equal(gps?.records[0]?.latitude, 20.7225);

  const checkout = withCheckoutCapturedAt(
    { stop_id: 220969, latitude: 20.72, longitude: -103.44, result_status: 'sale' },
    '2026-10-10T03:17:00.000Z',
  ) as Record<string, unknown>;
  assert.equal(checkout.client_checkout_at, '2026-10-10T03:17:00.000Z');
});

test('an in-progress stop can be closed when another visit or a failed photo blocks it', () => {
  assert.equal(shouldOfferStuckVisitClose({
    stopState: 'in_progress',
    hasAnotherActiveVisit: true,
    failedPhotoCount: 1,
  }), true);
  assert.equal(shouldOfferStuckVisitClose({
    stopState: 'pending',
    hasAnotherActiveVisit: false,
    failedPhotoCount: 1,
  }), false);
  assert.equal(stuckVisitSaleTotal({
    currentStopId: 8,
    stopId: 220969,
    visitSaleTotal: 0,
  }), 0);
  assert.equal(stuckVisitSaleTotal({
    currentStopId: 221167,
    stopId: 220969,
    visitSaleTotal: 342,
    hasSyncedSale: false,
  }), 0);
  assert.equal(stuckVisitSaleTotal({
    currentStopId: 221167,
    stopId: 220969,
    visitSaleTotal: 0,
    hasSyncedSale: true,
  }), 1);
});

test('collection snapshot naive UTC is shown in Mexico time', () => {
  assert.equal(formatOdooUtcAsMexico('2026-10-10 02:12:42'), '09/10/2026 20:12');
});

test('employee price rows accept many2one ids and numeric strings', () => {
  assert.equal(readEmployeePriceProductId([335, 'KOLDMICHE']), 335);
  assert.equal(readEmployeePriceProductId('42'), 42);
  assert.equal(readEmployeePriceAmount({ price_unit: '18.50' }), 18.5);
  assert.equal(readEmployeePriceAmount({ price: 12 }), 12);
  assert.equal(readEmployeePriceAmount({ note: 'missing' }), null);
});
