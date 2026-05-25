import assert from 'node:assert/strict';

interface VisitStateModule {
  buildStartedVisitState: (
    stop: {
      id: number;
      customer_id: number;
      customer_name: string;
      state: string;
      source_model: 'gf.route.stop';
      // BLD-20260424-STAB: shape sincronizado con GFStop. Sebastián
      // agregó _offrouteVisitId a GFStop pero olvidó propagarlo al test.
      _offrouteVisitId?: number | null;
    },
    lat: number,
    lon: number,
    now?: number,
  ) => {
    phase: 'checked_in';
    currentStopId: number;
    currentStop: { id: number; customer_name: string };
    offrouteVisitId: number | null;
    checkInTime: number;
    checkInLat: number;
    checkInLon: number;
    elapsedSeconds: number;
    saleLines: [];
    salePaymentMethod: null;
    analyticPlazaId: null;
    analyticUnId: null;
    salePhotoTaken: false;
    salePhotoUri: null;
    salePhotoUris: [];
    noSaleReasonId: null;
    noSaleReasonLabel: '';
    noSaleCompetitor: null;
    noSaleNotes: '';
    noSalePhotoTaken: false;
    noSalePhotoUri: null;
    noSalePhotoUris: [];
    saleConfirmed: false;
    saleOperationId: null;
  };
}

function testStartedVisitBeginsFromCleanTransactionalState(module: VisitStateModule) {
  const started = module.buildStartedVisitState({
    id: 44,
    customer_id: 710,
    customer_name: 'Cliente Ruta',
    state: 'in_progress',
    source_model: 'gf.route.stop',
    _offrouteVisitId: 12345,
  }, 20.1, -103.4, 123456789);

  assert.equal(started.phase, 'checked_in');
  assert.equal(started.currentStopId, 44);
  assert.equal(started.checkInTime, 123456789);
  assert.equal(started.checkInLat, 20.1);
  assert.equal(started.checkInLon, -103.4);
  assert.equal(started.offrouteVisitId, 12345);
  assert.equal(started.elapsedSeconds, 0);
  assert.deepEqual(started.saleLines, []);
  assert.equal(started.salePaymentMethod, null);
  assert.equal(started.analyticPlazaId, null);
  assert.equal(started.analyticUnId, null);
  assert.equal(started.salePhotoTaken, false);
  assert.equal(started.salePhotoUri, null);
  assert.deepEqual(started.salePhotoUris, []);
  assert.equal(started.noSaleReasonId, null);
  assert.equal(started.noSaleReasonLabel, '');
  assert.equal(started.noSaleCompetitor, null);
  assert.equal(started.noSaleNotes, '');
  assert.equal(started.noSalePhotoTaken, false);
  assert.equal(started.noSalePhotoUri, null);
  assert.deepEqual(started.noSalePhotoUris, []);
  assert.equal(started.saleConfirmed, false);
  assert.equal(started.saleOperationId, null);
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/visitState.ts', import.meta.url).pathname
  ) as VisitStateModule;

  testStartedVisitBeginsFromCleanTransactionalState(module);
  console.log('visit state tests: ok');
}

void main();
