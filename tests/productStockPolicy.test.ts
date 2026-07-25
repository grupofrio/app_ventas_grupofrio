import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductSelectionContextKey,
  canSelectProduct,
  formatProductStockLabel,
  normalizeProductQuantity,
  resolveInventoryCapturedAtMs,
  revalidateProductSelection,
  shouldRefreshInventoryAuthority,
} from '../src/services/productStockPolicy.ts';

test('offline_sale permits zero, cached, and unknown stock only while actually offline', () => {
  assert.equal(canSelectProduct({
    policy: 'offline_sale',
    isOnline: false,
    qtyDisplay: 0,
    freshness: 'cached',
  }), true);
  assert.equal(canSelectProduct({
    policy: 'offline_sale',
    isOnline: false,
    qtyDisplay: null,
    freshness: 'unknown',
  }), true);
  assert.equal(canSelectProduct({
    policy: 'offline_sale',
    isOnline: true,
    qtyDisplay: 7,
    freshness: 'cached',
  }), false);
});

test('strict policy remains stock-gated regardless of connectivity', () => {
  assert.equal(canSelectProduct({
    policy: 'strict',
    isOnline: false,
    qtyDisplay: 0,
    freshness: 'cached',
  }), false);
  assert.equal(canSelectProduct({
    policy: 'strict',
    isOnline: false,
    qtyDisplay: 2,
    freshness: 'cached',
  }), true);
  assert.equal(canSelectProduct({
    policy: 'offline_sale',
    isOnline: true,
    qtyDisplay: 2,
    freshness: 'authoritative',
  }), true);
});

test('offline_sale accepts any positive integer offline without stale stock cap', () => {
  assert.equal(normalizeProductQuantity({
    policy: 'offline_sale',
    isOnline: false,
    requestedQty: 500,
    qtyDisplay: 1,
    freshness: 'cached',
  }), 500);

  for (const requestedQty of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.equal(normalizeProductQuantity({
      policy: 'offline_sale',
      isOnline: false,
      requestedQty,
      qtyDisplay: null,
      freshness: 'unknown',
    }), null);
  }
});

test('strict quantity path caps against available stock and rejects invalid quantities', () => {
  assert.equal(normalizeProductQuantity({
    policy: 'strict',
    isOnline: true,
    requestedQty: 8,
    qtyDisplay: 3,
    freshness: 'authoritative',
  }), 3);
  assert.equal(normalizeProductQuantity({
    policy: 'offline_sale',
    isOnline: true,
    requestedQty: 8,
    qtyDisplay: 3,
    freshness: 'authoritative',
  }), 3);
  assert.equal(normalizeProductQuantity({
    policy: 'strict',
    isOnline: true,
    requestedQty: 1,
    qtyDisplay: 0,
    freshness: 'authoritative',
  }), null);
});

test('offline stock label is explicitly unvalidated and includes valid capture age', () => {
  assert.equal(formatProductStockLabel({
    policy: 'offline_sale',
    isOnline: false,
    qtyDisplay: 0,
    freshness: 'cached',
    capturedAtMs: 1_000,
    nowMs: 2 * 60 * 60 * 1_000 + 1_000,
  }), 'Stock sin validar · capturado hace 2 h');
  assert.equal(formatProductStockLabel({
    policy: 'offline_sale',
    isOnline: false,
    qtyDisplay: null,
    freshness: 'unknown',
    capturedAtMs: Number.NaN,
    nowMs: 10_000,
  }), 'Stock sin validar');
});

test('online labels and authority refresh never disguise stale inventory as offline bypass', () => {
  assert.equal(formatProductStockLabel({
    policy: 'offline_sale',
    isOnline: true,
    qtyDisplay: 4,
    freshness: 'cached',
  }), 'Actualizando inventario');
  assert.equal(formatProductStockLabel({
    policy: 'offline_sale',
    isOnline: true,
    qtyDisplay: 4,
    freshness: 'authoritative',
  }), '4 disp.');
  assert.equal(formatProductStockLabel({
    policy: 'strict',
    isOnline: false,
    qtyDisplay: 0,
    freshness: 'cached',
  }), 'Agotado');

  assert.equal(shouldRefreshInventoryAuthority({
    policy: 'offline_sale',
    isOnline: true,
    freshness: 'cached',
  }), true);
  assert.equal(shouldRefreshInventoryAuthority({
    policy: 'offline_sale',
    isOnline: true,
    freshness: 'unknown',
  }), true);
  assert.equal(shouldRefreshInventoryAuthority({
    policy: 'offline_sale',
    isOnline: true,
    freshness: 'authoritative',
  }), false);
  assert.equal(shouldRefreshInventoryAuthority({
    policy: 'offline_sale',
    isOnline: false,
    freshness: 'cached',
  }), false);
  assert.equal(shouldRefreshInventoryAuthority({
    policy: 'strict',
    isOnline: true,
    freshness: 'cached',
  }), false);
});

test('selection context changes with connectivity, freshness, and catalog identity', () => {
  const base = {
    visible: true,
    companyId: 34,
    planId: 88,
    partnerId: 99,
    pricelistId: 104,
    warehouseId: 8,
    isOnline: false,
    freshness: 'cached' as const,
    inventoryCapturedAtMs: 1_000,
    catalogIdentity: '10,20',
  };
  const original = buildProductSelectionContextKey(base);

  assert.notEqual(buildProductSelectionContextKey({ ...base, isOnline: true }), original);
  assert.notEqual(buildProductSelectionContextKey({ ...base, freshness: 'unknown' }), original);
  assert.notEqual(buildProductSelectionContextKey({ ...base, catalogIdentity: '10,30' }), original);
  assert.notEqual(buildProductSelectionContextKey({ ...base, inventoryCapturedAtMs: 2_000 }), original);
});

test('pending offline selection does not commit after reconnect', () => {
  const base = {
    visible: true,
    companyId: 34,
    planId: 88,
    partnerId: 99,
    pricelistId: 104,
    warehouseId: 8,
    freshness: 'cached' as const,
    inventoryCapturedAtMs: 1_000,
    catalogIdentity: '10',
  };
  const offlineContext = buildProductSelectionContextKey({ ...base, isOnline: false });
  const onlineContext = buildProductSelectionContextKey({ ...base, isOnline: true });
  let adds = 0;
  const decision = revalidateProductSelection({
    expectedContextKey: offlineContext,
    currentContextKey: onlineContext,
    productId: 10,
    requestedQty: 4,
    policy: 'offline_sale',
    isOnline: true,
    products: [{ productId: 10, qtyDisplay: 8, freshness: 'cached' }],
  });
  if (decision.ok) adds += 1;

  assert.deepEqual(decision, { ok: false, reason: 'context_changed' });
  assert.equal(adds, 0);
});

test('normal offline pending selection revalidates and commits without a stale cap', () => {
  const contextKey = buildProductSelectionContextKey({
    visible: true,
    companyId: 34,
    planId: 88,
    partnerId: 99,
    pricelistId: 104,
    warehouseId: 8,
    isOnline: false,
    freshness: 'cached',
    inventoryCapturedAtMs: 1_000,
    catalogIdentity: '10',
  });
  let adds = 0;
  const decision = revalidateProductSelection({
    expectedContextKey: contextKey,
    currentContextKey: contextKey,
    productId: 10,
    requestedQty: 20,
    policy: 'offline_sale',
    isOnline: false,
    products: [{ productId: 10, qtyDisplay: 1, freshness: 'cached' }],
  });
  if (decision.ok) adds += 1;

  assert.deepEqual(decision, { ok: true, quantity: 20, qtyDisplay: 1 });
  assert.equal(adds, 1);
});

test('captured timestamp uses valid cache then last successful load and rejects future values', () => {
  assert.equal(resolveInventoryCapturedAtMs({
    cachedAtMs: 1_000,
    lastSyncAtMs: 2_000,
    nowMs: 3_000,
  }), 1_000);
  assert.equal(resolveInventoryCapturedAtMs({
    cachedAtMs: Number.NaN,
    lastSyncAtMs: 2_000,
    nowMs: 3_000,
  }), 2_000);
  assert.equal(resolveInventoryCapturedAtMs({
    cachedAtMs: null,
    lastSyncAtMs: 4_000,
    nowMs: 3_000,
  }), null);
  assert.equal(formatProductStockLabel({
    policy: 'offline_sale',
    isOnline: false,
    qtyDisplay: 4,
    freshness: 'cached',
    capturedAtMs: 4_000,
    nowMs: 3_000,
  }), 'Stock sin validar');
});
