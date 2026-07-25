import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureSaleSubmissionInput,
  createSaleSubmissionFingerprint,
  decideSaleStockEnforcement,
  isApplicableAuthoritativeSaleInventory,
  isApplicableSaleSubmissionContext,
  isSameSaleSubmissionInput,
  isSameSaleConfirmationContext,
  shouldEnforceFreshSaleStock,
  type SaleConfirmationContext,
  type SaleSubmissionInput,
} from '../src/services/saleStockEnforcement.ts';

const confirmationContext: SaleConfirmationContext = {
  isAuthenticated: true,
  isOnline: true,
  employeeId: 7,
  companyId: 2,
  warehouseId: 8,
  mobileLocationId: 18,
  planId: 91,
  stopId: 33,
  partnerId: 44,
  pricelistId: 5,
  offrouteVisitId: null,
  activeVisitPhase: 'checked_in',
  activeVisitStopId: 33,
  activeVisitCurrentStopId: 33,
  activeVisitPartnerId: 44,
};

test('offline sale policy allows referential confirmation without enforcing captured stock', () => {
  const decision = decideSaleStockEnforcement({
    isOnline: false,
    policy: 'offline_sale',
    inventoryFreshness: 'cached',
  });

  assert.deepEqual(decision, {
    allowConfirm: true,
    shouldRefresh: false,
    enforceFreshStock: false,
  });
  assert.equal(shouldEnforceFreshSaleStock({
    isOnline: false,
    policy: 'offline_sale',
    inventoryFreshness: 'unknown',
  }), false);
});

test('online sale blocks cached or unknown inventory and requests authoritative refresh', () => {
  for (const inventoryFreshness of ['cached', 'unknown'] as const) {
    assert.deepEqual(decideSaleStockEnforcement({
      isOnline: true,
      policy: 'offline_sale',
      inventoryFreshness,
    }), {
      allowConfirm: false,
      shouldRefresh: true,
      enforceFreshStock: false,
    });
  }
});

test('online sale with authoritative inventory preserves strict fresh-stock validation', () => {
  assert.deepEqual(decideSaleStockEnforcement({
    isOnline: true,
    policy: 'offline_sale',
    inventoryFreshness: 'authoritative',
  }), {
    allowConfirm: true,
    shouldRefresh: false,
    enforceFreshStock: true,
  });
  assert.equal(shouldEnforceFreshSaleStock({
    isOnline: true,
    policy: 'offline_sale',
    inventoryFreshness: 'authoritative',
  }), true);
});

test('strict policy never enables the offline bypass', () => {
  for (const isOnline of [true, false] as const) {
    for (const inventoryFreshness of ['authoritative', 'cached', 'unknown'] as const) {
      assert.deepEqual(decideSaleStockEnforcement({
        isOnline,
        policy: 'strict',
        inventoryFreshness,
      }), {
        allowConfirm: true,
        shouldRefresh: false,
        enforceFreshStock: true,
      });
    }
  }
});

test('unknown or malformed connectivity fails closed instead of enabling offline bypass', () => {
  for (const isOnline of [null, undefined, 'offline'] as const) {
    assert.deepEqual(decideSaleStockEnforcement({
      isOnline,
      policy: 'offline_sale',
      inventoryFreshness: 'cached',
    } as never), {
      allowConfirm: false,
      shouldRefresh: false,
      enforceFreshStock: false,
    });
  }
});

test('malformed policy and freshness values fail closed at runtime', () => {
  assert.deepEqual(decideSaleStockEnforcement({
    isOnline: false,
    policy: 'offline-ish',
    inventoryFreshness: 'cached',
  } as never), {
    allowConfirm: false,
    shouldRefresh: false,
    enforceFreshStock: true,
  });
  assert.deepEqual(decideSaleStockEnforcement({
    isOnline: true,
    policy: 'offline_sale',
    inventoryFreshness: 'fresh-ish',
  } as never), {
    allowConfirm: false,
    shouldRefresh: true,
    enforceFreshStock: false,
  });
});

test('keeps one exact confirmation identity across matching live reads', () => {
  assert.equal(isSameSaleConfirmationContext(
    confirmationContext,
    { ...confirmationContext },
  ), true);
});

test('rejects connectivity changes in either direction during confirmation', () => {
  assert.equal(isSameSaleConfirmationContext(
    confirmationContext,
    { ...confirmationContext, isOnline: false },
  ), false);
  assert.equal(isSameSaleConfirmationContext(
    { ...confirmationContext, isOnline: false },
    confirmationContext,
  ), false);
  assert.equal(isSameSaleConfirmationContext(
    confirmationContext,
    { ...confirmationContext, isOnline: null },
  ), false);
});

test('rejects session, warehouse, route, and stop identity changes', () => {
  for (const changed of [
    { employeeId: 9 },
    { companyId: 3 },
    { warehouseId: 9 },
    { mobileLocationId: 19 },
    { planId: 92 },
    { stopId: 34 },
    { partnerId: 45 },
    { pricelistId: 6 },
    { offrouteVisitId: 88 },
    { isAuthenticated: false },
  ]) {
    assert.equal(isSameSaleConfirmationContext(
      confirmationContext,
      { ...confirmationContext, ...changed },
    ), false);
  }
});

test('rejects a cleared, switched, or ended active visit while the route stop remains', () => {
  for (const changed of [
    {
      activeVisitStopId: null,
      activeVisitCurrentStopId: null,
      activeVisitPartnerId: null,
    },
    { activeVisitCurrentStopId: null },
    { activeVisitPartnerId: 45 },
    {
      activeVisitStopId: 34,
      activeVisitCurrentStopId: 34,
      activeVisitPartnerId: 45,
    },
    { activeVisitPhase: 'checked_out' },
  ]) {
    assert.equal(isSameSaleConfirmationContext(
      confirmationContext,
      { ...confirmationContext, ...changed } as SaleConfirmationContext,
    ), false);
  }
});

test('accepts only an authoritative refresh applicable to the captured context', () => {
  assert.equal(isApplicableAuthoritativeSaleInventory({
    expectedContext: confirmationContext,
    currentContext: { ...confirmationContext },
    inventory: {
      inventoryFreshness: 'authoritative',
      loadedWarehouseId: 8,
      inventorySource: 'truck_stock',
    },
    loadResult: {
      ok: true,
      authoritative: true,
      warehouseId: 8,
      source: 'truck_stock',
    },
  }), true);
});

test('rejects another context authoritative result and mismatched authority evidence', () => {
  const validInventory = {
    inventoryFreshness: 'authoritative' as const,
    loadedWarehouseId: 8,
    inventorySource: 'truck_stock' as const,
  };
  const validResult = {
    ok: true as const,
    authoritative: true as const,
    warehouseId: 8,
    source: 'truck_stock' as const,
  };

  assert.equal(isApplicableAuthoritativeSaleInventory({
    expectedContext: confirmationContext,
    currentContext: { ...confirmationContext, warehouseId: 9 },
    inventory: {
      ...validInventory,
      loadedWarehouseId: 9,
    },
    loadResult: {
      ...validResult,
      warehouseId: 9,
    },
  }), false);
  assert.equal(isApplicableAuthoritativeSaleInventory({
    expectedContext: confirmationContext,
    currentContext: { ...confirmationContext },
    inventory: { ...validInventory, loadedWarehouseId: 9 },
    loadResult: validResult,
  }), false);
  assert.equal(isApplicableAuthoritativeSaleInventory({
    expectedContext: confirmationContext,
    currentContext: { ...confirmationContext },
    inventory: { ...validInventory, inventorySource: 'stock_quant' },
    loadResult: validResult,
  }), false);
  assert.equal(isApplicableAuthoritativeSaleInventory({
    expectedContext: confirmationContext,
    currentContext: { ...confirmationContext },
    inventory: validInventory,
    loadResult: {
      ok: false,
      authoritative: false,
      reason: 'network_error',
    },
  }), false);
});

test('validates pre-existing authoritative inventory without fabricating a load result', () => {
  assert.equal(isApplicableAuthoritativeSaleInventory({
    expectedContext: confirmationContext,
    currentContext: { ...confirmationContext },
    inventory: {
      inventoryFreshness: 'authoritative',
      loadedWarehouseId: 8,
      inventorySource: 'stock_quant',
    },
  }), true);
  assert.equal(isApplicableAuthoritativeSaleInventory({
    expectedContext: { ...confirmationContext, isOnline: false },
    currentContext: { ...confirmationContext, isOnline: false },
    inventory: {
      inventoryFreshness: 'authoritative',
      loadedWarehouseId: 8,
      inventorySource: 'stock_quant',
    },
  }), false);
});

test('revalidates fresh online authority after awaited submission boundaries', () => {
  const applicableInput = {
    expectedContext: confirmationContext,
    currentContext: { ...confirmationContext },
    inventory: {
      inventoryFreshness: 'authoritative' as const,
      loadedWarehouseId: 8,
      inventorySource: 'truck_stock',
    },
  };
  assert.equal(isApplicableSaleSubmissionContext(applicableInput), true);

  for (const inventory of [
    { ...applicableInput.inventory, inventoryFreshness: 'cached' as const },
    { ...applicableInput.inventory, loadedWarehouseId: 9 },
    { ...applicableInput.inventory, inventorySource: 'global_legacy' },
  ]) {
    assert.equal(isApplicableSaleSubmissionContext({
      ...applicableInput,
      inventory,
    }), false);
  }
});

test('offline submission ignores inventory authority only while its live context is unchanged', () => {
  const offlineContext = { ...confirmationContext, isOnline: false };
  const cachedInventory = {
    inventoryFreshness: 'cached' as const,
    loadedWarehouseId: null,
    inventorySource: 'global_legacy',
  };
  assert.equal(isApplicableSaleSubmissionContext({
    expectedContext: offlineContext,
    currentContext: { ...offlineContext },
    inventory: cachedInventory,
  }), true);
  assert.equal(isApplicableSaleSubmissionContext({
    expectedContext: offlineContext,
    currentContext: { ...offlineContext, activeVisitCurrentStopId: null },
    inventory: cachedInventory,
  }), false);
  assert.equal(isApplicableSaleSubmissionContext({
    expectedContext: offlineContext,
    currentContext: { ...offlineContext, isOnline: true },
    inventory: cachedInventory,
  }), false);
});

const saleSubmissionInput: SaleSubmissionInput = {
  saleLines: [{
    productId: 10,
    productName: 'Producto reservado',
    price: 42.5,
    priceSource: 'prepared_customer',
    priceCapturedAtMs: 1_725_000_000_000,
    pricelistId: 5,
    qty: 3,
    stock: 1,
    weight: 5,
  }],
  salePaymentMethod: 'cash',
  salePhotoTaken: true,
  salePhotoUri: 'file:///private/proof-primary.jpg?token=secret-value',
  salePhotoUris: [
    'file:///private/proof-primary.jpg?token=secret-value',
    'file:///private/proof-secondary.jpg',
  ],
};

test('captures a deep immutable sale input with a deterministic opaque fingerprint', () => {
  const mutableInput = structuredClone(saleSubmissionInput);
  const captured = captureSaleSubmissionInput(mutableInput);
  const same = captureSaleSubmissionInput(structuredClone(saleSubmissionInput));

  assert.equal(Object.isFrozen(captured), true);
  assert.equal(Object.isFrozen(captured.saleLines), true);
  assert.equal(Object.isFrozen(captured.saleLines[0]), true);
  assert.equal(Object.isFrozen(captured.salePhotoUris), true);
  assert.equal(captured.fingerprint, same.fingerprint);
  assert.equal(isSameSaleSubmissionInput(captured, same), true);
  assert.match(captured.fingerprint, /^sale_input_v1_[0-9a-f]+$/);
  assert.equal(captured.fingerprint.includes('secret-value'), false);
  assert.equal(captured.fingerprint.includes('Producto reservado'), false);
  assert.equal(
    captured.fingerprint,
    createSaleSubmissionFingerprint(saleSubmissionInput),
  );

  mutableInput.saleLines[0].qty = 99;
  mutableInput.salePhotoUris[0] = 'file:///mutated.jpg';
  assert.equal(captured.saleLines[0].qty, 3);
  assert.equal(captured.salePhotoUris[0], saleSubmissionInput.salePhotoUris[0]);
});

test('rejects cart, payment, and proof mutations across awaited boundaries', () => {
  const captured = captureSaleSubmissionInput(saleSubmissionInput);
  const mutations: SaleSubmissionInput[] = [
    {
      ...saleSubmissionInput,
      saleLines: [{ ...saleSubmissionInput.saleLines[0], qty: 4 }],
    },
    {
      ...saleSubmissionInput,
      saleLines: [{ ...saleSubmissionInput.saleLines[0], price: 43 }],
    },
    {
      ...saleSubmissionInput,
      saleLines: [{
        ...saleSubmissionInput.saleLines[0],
        priceSource: 'last_known_customer',
      }],
    },
    { ...saleSubmissionInput, salePaymentMethod: 'credit' },
    { ...saleSubmissionInput, salePhotoTaken: false },
    { ...saleSubmissionInput, salePhotoUri: 'file:///private/other.jpg' },
    {
      ...saleSubmissionInput,
      salePhotoUris: [...saleSubmissionInput.salePhotoUris].reverse(),
    },
  ];

  for (const mutation of mutations) {
    assert.equal(isSameSaleSubmissionInput(
      captured,
      captureSaleSubmissionInput(mutation),
    ), false);
  }
});
