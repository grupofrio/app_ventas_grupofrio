import assert from 'node:assert/strict';

interface VisitPersistenceModule {
  buildVisitSnapshot: (input: {
    phase: 'idle' | 'checked_in' | 'selling' | 'no_selling' | 'checked_out';
    currentStopId: number | null;
    currentStop: {
      id: number;
      customer_id: number;
      customer_name: string;
      state: string;
      source_model: 'gf.route.stop';
    } | null;
    offrouteVisitId: number | null;
    checkInTime: number | null;
    checkInLat: number | null;
    checkInLon: number | null;
    elapsedSeconds: number;
    saleConfirmed?: boolean;
    saleOperationId?: string | null;
    saleReadyToContinue?: boolean;
    saleRecoveryPersistenceFailed?: boolean;
    saleRecoveryIntent?: unknown;
  }) => null | {
    phase: string;
    currentStopId: number;
    currentStop: { id: number; customer_name: string };
    offrouteVisitId: number | null;
    checkInTime: number;
    checkInLat: number | null;
    checkInLon: number | null;
    elapsedSeconds: number;
    saleConfirmed: boolean;
    saleOperationId: string | null;
    saleReadyToContinue: boolean;
    saleRecoveryPersistenceFailed: boolean;
    saleRecoveryIntent: unknown;
  };
  shouldRehydrateVisit: (
    snapshot: { currentStopId: number } | null,
    stops: Array<{ id: number; state: string }>,
  ) => boolean;
  shouldResetVisitAfterPlanRefresh: (
    currentStopId: number | null,
    stops: Array<{ id: number; state: string }>,
  ) => boolean;
}

function testBuildActiveVisitSnapshot(module: VisitPersistenceModule) {
  const snapshot = module.buildVisitSnapshot({
    phase: 'checked_in',
    currentStopId: 15,
    currentStop: {
      id: 15,
      customer_id: 200,
      customer_name: 'Abarrotes Centro',
      state: 'in_progress',
      source_model: 'gf.route.stop',
    },
    offrouteVisitId: null,
    checkInTime: 123456,
    checkInLat: 19.4,
    checkInLon: -99.1,
    elapsedSeconds: 90,
  });

  assert.deepEqual(snapshot, {
    phase: 'checked_in',
    currentStopId: 15,
    currentStop: {
      id: 15,
      customer_id: 200,
      customer_name: 'Abarrotes Centro',
      state: 'in_progress',
      source_model: 'gf.route.stop',
    },
    offrouteVisitId: null,
    checkInTime: 123456,
    checkInLat: 19.4,
    checkInLon: -99.1,
    elapsedSeconds: 90,
    // P0-2: defaults when not provided.
    saleConfirmed: false,
    saleOperationId: null,
    saleReadyToContinue: false,
    saleRecoveryPersistenceFailed: false,
    saleRecoveryIntent: null,
  });
}

function testPendingConfirmationNeverPersistsWithoutMatchingIntent(module: VisitPersistenceModule) {
  const base = {
    phase: 'selling' as const,
    currentStopId: 15,
    currentStop: {
      id: 15,
      customer_id: 200,
      customer_name: 'Abarrotes Centro',
      state: 'in_progress',
      source_model: 'gf.route.stop' as const,
    },
    offrouteVisitId: null,
    checkInTime: 123456,
    checkInLat: null,
    checkInLon: null,
    elapsedSeconds: 5,
    saleConfirmed: true,
    saleOperationId: 'sale-op-1',
    saleReadyToContinue: false,
  };

  const lockOnly = module.buildVisitSnapshot(base);
  assert.ok(lockOnly);
  assert.equal(lockOnly.saleConfirmed, false);
  assert.equal(lockOnly.saleOperationId, null);
  assert.equal(lockOnly.saleRecoveryIntent, null);

  const ticketSnapshot = {
    saleId: 'sale-op-1', customerName: 'Cliente', sellerName: 'Vendedor',
    paymentMethod: 'cash', paymentLabel: 'Efectivo', createdAt: '2026-07-21T10:00:00.000Z',
    lines: [], subtotal: 100, total: 100, totalKg: 10,
  };
  const saleRecoveryIntent = {
    version: 1,
    operationId: 'sale-op-1',
    queuePayload: { _operationId: 'sale-op-1', _clientCustomerName: 'Cliente', _clientTotal: 100 },
    stopId: 15,
    photoUris: ['file://sale.jpg'],
    ticketSnapshot,
  };
  const recoverable = module.buildVisitSnapshot({ ...base, saleRecoveryIntent });
  assert.ok(recoverable);
  assert.equal(recoverable.saleConfirmed, true);
  assert.equal(recoverable.saleOperationId, 'sale-op-1');
  assert.deepEqual(recoverable.saleRecoveryIntent, saleRecoveryIntent);
}

// P0-2: snapshot must carry sale confirmation + idempotency key.
function testSnapshotCarriesSaleConfirmation(module: VisitPersistenceModule) {
  const snapshot = module.buildVisitSnapshot({
    phase: 'selling',
    currentStopId: 15,
    currentStop: {
      id: 15,
      customer_id: 200,
      customer_name: 'Abarrotes Centro',
      state: 'in_progress',
      source_model: 'gf.route.stop',
    },
    offrouteVisitId: null,
    checkInTime: 123456,
    checkInLat: null,
    checkInLon: null,
    elapsedSeconds: 5,
    saleConfirmed: true,
    saleOperationId: 'sale_123_abc',
    saleReadyToContinue: true,
    saleRecoveryPersistenceFailed: true,
  });
  assert.ok(snapshot);
  assert.equal(snapshot!.saleConfirmed, true);
  assert.equal(snapshot!.saleOperationId, 'sale_123_abc');
  assert.equal(snapshot!.saleReadyToContinue, true);
  assert.equal(snapshot!.saleRecoveryPersistenceFailed, true);
}

function testIdleVisitDoesNotPersist(module: VisitPersistenceModule) {
  const snapshot = module.buildVisitSnapshot({
    phase: 'idle',
    currentStopId: null,
    currentStop: null,
    offrouteVisitId: null,
    checkInTime: null,
    checkInLat: null,
    checkInLon: null,
    elapsedSeconds: 0,
  });

  assert.equal(snapshot, null);
}

function testRehydrateRequiresInProgressStop(module: VisitPersistenceModule) {
  assert.equal(
    module.shouldRehydrateVisit(
      { currentStopId: 15 },
      [
        { id: 15, state: 'in_progress' },
        { id: 16, state: 'pending' },
      ],
    ),
    true,
  );

  assert.equal(
    module.shouldRehydrateVisit(
      { currentStopId: 15 },
      [
        { id: 15, state: 'done' },
      ],
    ),
    false,
  );
}

function testResetVisitWhenCurrentStopDisappearsFromFreshPlan(module: VisitPersistenceModule) {
  assert.equal(
    module.shouldResetVisitAfterPlanRefresh(
      15,
      [
        { id: 16, state: 'pending' },
        { id: 17, state: 'done' },
      ],
    ),
    true,
  );

  assert.equal(
    module.shouldResetVisitAfterPlanRefresh(
      15,
      [
        { id: 15, state: 'pending' },
        { id: 17, state: 'done' },
      ],
    ),
    false,
  );

  assert.equal(
    module.shouldResetVisitAfterPlanRefresh(null, [
      { id: 15, state: 'pending' },
    ]),
    false,
  );
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/visitPersistence.ts', import.meta.url).pathname
  ) as VisitPersistenceModule;

  testBuildActiveVisitSnapshot(module);
  testPendingConfirmationNeverPersistsWithoutMatchingIntent(module);
  testSnapshotCarriesSaleConfirmation(module);
  testIdleVisitDoesNotPersist(module);
  testRehydrateRequiresInProgressStop(module);
  testResetVisitWhenCurrentStopDisappearsFromFreshPlan(module);
  console.log('visit persistence tests: ok');
}

void main();
