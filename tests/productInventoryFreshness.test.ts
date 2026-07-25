import assert from 'node:assert/strict';
import test from 'node:test';

import { describeInventoryAuthority } from '../src/services/productInventoryFreshness.ts';

test('marks only a fresh online truck-stock load for the expected warehouse as authoritative', () => {
  assert.equal(describeInventoryAuthority({
    isOnline: true,
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'truck_stock',
    fromCache: false,
  }), 'authoritative');
});

test('keeps cached and unknown inventory non-authoritative when connectivity returns', () => {
  const base = {
    isOnline: true,
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'truck_stock' as const,
  };

  assert.equal(describeInventoryAuthority({ ...base, fromCache: true }), 'cached');
  assert.equal(describeInventoryAuthority({
    ...base,
    fromCache: false,
    inventorySource: null,
  }), 'unknown');
  assert.equal(describeInventoryAuthority({
    ...base,
    fromCache: false,
    inventorySource: 'stock_quant',
  }), 'unknown');
  assert.equal(describeInventoryAuthority({
    ...base,
    fromCache: false,
    inventorySource: 'global_legacy',
  }), 'unknown');
});

test('requires confirmed connectivity and the same positive safe warehouse', () => {
  const base = {
    isOnline: true,
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'truck_stock' as const,
    fromCache: false,
  };

  assert.equal(describeInventoryAuthority({ ...base, isOnline: false }), 'unknown');
  assert.equal(describeInventoryAuthority({ ...base, loadedWarehouseId: 9 }), 'unknown');
  assert.equal(describeInventoryAuthority({ ...base, loadedWarehouseId: null }), 'unknown');
  assert.equal(describeInventoryAuthority({ ...base, expectedWarehouseId: 0 }), 'unknown');
  assert.equal(describeInventoryAuthority({
    ...base,
    loadedWarehouseId: Number.MAX_SAFE_INTEGER + 1,
    expectedWarehouseId: Number.MAX_SAFE_INTEGER + 1,
  }), 'unknown');
});

test('is runtime-safe for malformed JavaScript callers', () => {
  assert.equal(describeInventoryAuthority(null as never), 'unknown');
  assert.equal(describeInventoryAuthority({
    isOnline: 'yes',
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'truck_stock',
    fromCache: false,
  } as never), 'unknown');
  assert.equal(describeInventoryAuthority({
    isOnline: true,
    loadedWarehouseId: 8,
    expectedWarehouseId: 8,
    inventorySource: 'server_guess',
    fromCache: false,
  } as never), 'unknown');
});
