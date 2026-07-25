import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canSelectProduct,
  formatProductStockLabel,
  normalizeProductQuantity,
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
