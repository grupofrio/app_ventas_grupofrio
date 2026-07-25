import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideSaleStockEnforcement,
  shouldEnforceFreshSaleStock,
} from '../src/services/saleStockEnforcement.ts';

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
