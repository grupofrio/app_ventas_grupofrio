import assert from 'node:assert/strict';
import test from 'node:test';

import * as saleStockEnforcement from '../src/services/saleStockEnforcement.ts';
import type { SaleConfirmationContext } from '../src/services/saleStockEnforcement.ts';

type SaleLine = {
  productId: number;
  qty: number;
  stock: number | null;
};

type EditDecision =
  | {
      status: 'apply';
      quantity: number;
      enforceStock: boolean;
      stockLimit?: number | null;
    }
  | { status: 'blocked' };

type ResolveLiveSaleQuantityEdit = (input: {
  expectedContext: SaleConfirmationContext;
  currentContext: SaleConfirmationContext;
  inventory: {
    inventoryFreshness: 'authoritative' | 'cached' | 'unknown';
    loadedWarehouseId: number | null;
    inventorySource: string | null;
  };
  products: readonly { id: number; qty_display?: number | null }[];
  productId: number;
  requestedQty: number;
}) => EditDecision;

type ApplySaleQuantityEditToLines = <Line extends SaleLine>(
  lines: readonly Line[],
  productId: number,
  decision: EditDecision,
) => Line[];

function resolver(): ResolveLiveSaleQuantityEdit {
  const candidate = Reflect.get(
    saleStockEnforcement,
    'resolveLiveSaleQuantityEdit',
  );
  assert.equal(
    typeof candidate,
    'function',
    'la edición debe tener una frontera pura de stock vivo',
  );
  return candidate as ResolveLiveSaleQuantityEdit;
}

function applyEdit(): ApplySaleQuantityEditToLines {
  const candidate = Reflect.get(
    saleStockEnforcement,
    'applySaleQuantityEditToLines',
  );
  assert.equal(
    typeof candidate,
    'function',
    'la transición del carrito debe aceptar el límite vivo explícito',
  );
  return candidate as ApplySaleQuantityEditToLines;
}

const onlineContext: SaleConfirmationContext = {
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

const authoritativeInventory = {
  inventoryFreshness: 'authoritative' as const,
  loadedWarehouseId: 8,
  inventorySource: 'truck_stock',
};

test('online edit ignores null or stale captured stock and clamps to live qty_display', () => {
  for (const capturedStock of [null, 12]) {
    const decision = resolver()({
      expectedContext: onlineContext,
      currentContext: { ...onlineContext },
      inventory: authoritativeInventory,
      products: [{ id: 10, qty_display: 3 }],
      productId: 10,
      requestedQty: 9,
    });
    const lines = applyEdit()([
      { productId: 10, qty: 1, stock: capturedStock },
    ], 10, decision);

    assert.deepEqual(decision, {
      status: 'apply',
      quantity: 9,
      enforceStock: true,
      stockLimit: 3,
    });
    assert.equal(lines[0].qty, 3);
    assert.equal(lines[0].stock, capturedStock, 'stock referencial no se reescribe');
  }
});

test('a reconnect uses current online authority instead of the offline render bypass', () => {
  const decision = resolver()({
    expectedContext: { ...onlineContext, isOnline: false },
    currentContext: { ...onlineContext, isOnline: true },
    inventory: authoritativeInventory,
    products: [{ id: 10, qty_display: 2 }],
    productId: 10,
    requestedQty: 8,
  });
  const lines = applyEdit()([
    { productId: 10, qty: 1, stock: 20 },
  ], 10, decision);

  assert.equal(decision.status, 'apply');
  assert.equal(decision.status === 'apply' && decision.enforceStock, true);
  assert.equal(lines[0].qty, 2);
});

test('online edit fails closed when live authority disappears or belongs to another warehouse', () => {
  for (const inventory of [
    { ...authoritativeInventory, inventoryFreshness: 'cached' as const },
    { ...authoritativeInventory, loadedWarehouseId: 9 },
    { ...authoritativeInventory, inventorySource: 'global_legacy' },
  ]) {
    const decision = resolver()({
      expectedContext: onlineContext,
      currentContext: { ...onlineContext },
      inventory,
      products: [{ id: 10, qty_display: 99 }],
      productId: 10,
      requestedQty: 8,
    });
    const original = [{ productId: 10, qty: 1, stock: 20 }];
    const lines = applyEdit()(original, 10, decision);

    assert.deepEqual(decision, { status: 'blocked' });
    assert.strictEqual(lines, original, 'una edición bloqueada no publica cambios');
  }
});

test('offline edit keeps any positive quantity despite referential stock', () => {
  const offlineContext = { ...onlineContext, isOnline: false };
  const decision = resolver()({
    expectedContext: onlineContext,
    currentContext: offlineContext,
    inventory: {
      inventoryFreshness: 'cached',
      loadedWarehouseId: 8,
      inventorySource: 'truck_stock',
    },
    products: [{ id: 10, qty_display: 1 }],
    productId: 10,
    requestedQty: 500,
  });
  const lines = applyEdit()([
    { productId: 10, qty: 1, stock: null },
  ], 10, decision);

  assert.deepEqual(decision, {
    status: 'apply',
    quantity: 500,
    enforceStock: false,
    stockLimit: null,
  });
  assert.equal(lines[0].qty, 500);
});

test('zero still removes the line without requiring inventory authority', () => {
  const decision = resolver()({
    expectedContext: onlineContext,
    currentContext: { ...onlineContext },
    inventory: {
      ...authoritativeInventory,
      inventoryFreshness: 'unknown',
    },
    products: [],
    productId: 10,
    requestedQty: 0,
  });
  const lines = applyEdit()([
    { productId: 10, qty: 1, stock: null },
    { productId: 20, qty: 2, stock: 2 },
  ], 10, decision);

  assert.equal(decision.status, 'apply');
  assert.deepEqual(lines.map((line) => line.productId), [20]);
});

test('a changed visit identity blocks even an otherwise valid live edit', () => {
  const decision = resolver()({
    expectedContext: onlineContext,
    currentContext: {
      ...onlineContext,
      stopId: 34,
      activeVisitStopId: 34,
      activeVisitCurrentStopId: 34,
    },
    inventory: authoritativeInventory,
    products: [{ id: 10, qty_display: 3 }],
    productId: 10,
    requestedQty: 2,
  });

  assert.deepEqual(decision, { status: 'blocked' });
});
