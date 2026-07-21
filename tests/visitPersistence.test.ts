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
    saleRecoveryPersistenceFailed?: boolean;
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
    saleRecoveryPersistenceFailed: boolean;
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
    saleRecoveryPersistenceFailed: false,
  });
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
    saleRecoveryPersistenceFailed: true,
  });
  assert.ok(snapshot);
  assert.equal(snapshot!.saleConfirmed, true);
  assert.equal(snapshot!.saleOperationId, 'sale_123_abc');
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
  testSnapshotCarriesSaleConfirmation(module);
  testIdleVisitDoesNotPersist(module);
  testRehydrateRequiresInProgressStop(module);
  testResetVisitWhenCurrentStopDisappearsFromFreshPlan(module);
  console.log('visit persistence tests: ok');
}

void main();
