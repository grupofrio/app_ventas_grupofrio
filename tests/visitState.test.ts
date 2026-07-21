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
    saleReadyToContinue: false;
    saleRecoveryPersistenceFailed: false;
    saleRecoveryIntent: null;
  };
  restoreSaleRecoveryState: (snapshot: {
    saleConfirmed?: boolean;
    saleOperationId?: string | null;
    saleReadyToContinue?: boolean;
    saleRecoveryPersistenceFailed?: boolean;
    saleRecoveryIntent?: unknown;
  }) => {
    saleConfirmed: boolean;
    saleOperationId: string | null;
    saleReadyToContinue: boolean;
    saleRecoveryPersistenceFailed: boolean;
    saleRecoveryIntent: unknown;
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
  assert.equal(started.saleReadyToContinue, false);
  assert.equal(started.saleRecoveryPersistenceFailed, false);
  assert.equal(started.saleRecoveryIntent, null);
}

function testRestoresSaleRecoveryStateWithBackcompat(module: VisitStateModule) {
  assert.deepEqual(module.restoreSaleRecoveryState({
    saleConfirmed: true,
    saleOperationId: null,
  }), {
    saleConfirmed: true,
    saleOperationId: null,
    saleReadyToContinue: true,
    saleRecoveryPersistenceFailed: false,
    saleRecoveryIntent: null,
  });

  assert.deepEqual(module.restoreSaleRecoveryState({
    saleConfirmed: true,
    saleOperationId: null,
    saleReadyToContinue: false,
  }), {
    saleConfirmed: false,
    saleOperationId: null,
    saleReadyToContinue: false,
    saleRecoveryPersistenceFailed: false,
    saleRecoveryIntent: null,
  });

  assert.deepEqual(module.restoreSaleRecoveryState({
    saleConfirmed: true,
    saleOperationId: 'sale-op-old',
  }), {
    saleConfirmed: false,
    saleOperationId: null,
    saleReadyToContinue: false,
    saleRecoveryPersistenceFailed: false,
    saleRecoveryIntent: null,
  });

  assert.deepEqual(module.restoreSaleRecoveryState({
    saleConfirmed: false,
    saleOperationId: null,
  }), {
    saleConfirmed: false,
    saleOperationId: null,
    saleReadyToContinue: false,
    saleRecoveryPersistenceFailed: false,
    saleRecoveryIntent: null,
  });

  assert.deepEqual(module.restoreSaleRecoveryState({
    saleConfirmed: true,
    saleOperationId: 'sale-op-blocked',
    saleReadyToContinue: true,
    saleRecoveryPersistenceFailed: true,
  }), {
    saleConfirmed: true,
    saleOperationId: 'sale-op-blocked',
    saleReadyToContinue: true,
    saleRecoveryPersistenceFailed: false,
    saleRecoveryIntent: null,
  });

  const saleRecoveryIntent = {
    version: 1,
    operationId: 'sale-op-recoverable',
    queuePayload: {
      _operationId: 'sale-op-recoverable',
      _clientCustomerName: 'Cliente',
      _clientTotal: 100,
    },
    stopId: 44,
    photoUris: ['file://sale.jpg'],
    ticketSnapshot: {
      saleId: 'sale-op-recoverable',
      customerName: 'Cliente',
      sellerName: 'Vendedor',
      paymentMethod: 'cash',
      paymentLabel: 'Efectivo',
      createdAt: '2026-07-21T10:00:00.000Z',
      lines: [],
      subtotal: 100,
      total: 100,
      totalKg: 10,
    },
  };
  assert.deepEqual(module.restoreSaleRecoveryState({
    saleConfirmed: true,
    saleOperationId: 'sale-op-recoverable',
    saleReadyToContinue: false,
    saleRecoveryPersistenceFailed: true,
    saleRecoveryIntent,
  }), {
    saleConfirmed: true,
    saleOperationId: 'sale-op-recoverable',
    saleReadyToContinue: false,
    saleRecoveryPersistenceFailed: false,
    saleRecoveryIntent,
  });
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/visitState.ts', import.meta.url).pathname
  ) as VisitStateModule;

  testStartedVisitBeginsFromCleanTransactionalState(module);
  testRestoresSaleRecoveryStateWithBackcompat(module);
  console.log('visit state tests: ok');
}

void main();
