import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVisitSnapshot } from '../src/services/visitPersistence.ts';
import { restoreSaleRecoveryState } from '../src/services/visitState.ts';

const activeVisit = {
  phase: 'selling' as const,
  currentStopId: 44,
  currentStop: {
    id: 44,
    customer_id: 501,
    customer_name: 'Abarrotes Lupita',
    state: 'in_progress' as const,
    source_model: 'gf.route.stop' as const,
  },
  offrouteVisitId: null,
  checkInTime: 123_456,
  checkInLat: 19.4,
  checkInLon: -99.1,
  elapsedSeconds: 10,
};

test('a prior-version lock without an intent remains fail-closed across restore and background snapshot', () => {
  const restored = restoreSaleRecoveryState({
    saleConfirmed: true,
    saleOperationId: 'sale-legacy-1',
    saleReadyToContinue: false,
  });

  assert.deepEqual(restored, {
    saleConfirmed: true,
    saleOperationId: 'sale-legacy-1',
    saleReadyToContinue: false,
    saleRecoveryPersistenceFailed: true,
    saleRecoveryIntent: null,
  });

  const immediateBackgroundSnapshot = buildVisitSnapshot({
    ...activeVisit,
    ...restored,
  });
  assert.ok(immediateBackgroundSnapshot);
  assert.equal(immediateBackgroundSnapshot.saleConfirmed, true);
  assert.equal(immediateBackgroundSnapshot.saleOperationId, 'sale-legacy-1');
  assert.equal(immediateBackgroundSnapshot.saleReadyToContinue, false);
  assert.equal(immediateBackgroundSnapshot.saleRecoveryPersistenceFailed, true);
  assert.equal(immediateBackgroundSnapshot.saleRecoveryIntent, null);

  assert.deepEqual(restoreSaleRecoveryState(immediateBackgroundSnapshot), restored);
});

test('a fresh in-memory lock without intent or failure evidence cannot become durable', () => {
  const snapshot = buildVisitSnapshot({
    ...activeVisit,
    saleConfirmed: true,
    saleOperationId: 'sale-new-before-barrier',
    saleReadyToContinue: false,
    saleRecoveryPersistenceFailed: false,
    saleRecoveryIntent: null,
  });

  assert.ok(snapshot);
  assert.equal(snapshot.saleConfirmed, false);
  assert.equal(snapshot.saleOperationId, null);
  assert.equal(snapshot.saleRecoveryPersistenceFailed, false);
});
