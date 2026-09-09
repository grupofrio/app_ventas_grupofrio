import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import * as cache from '../src/services/pricelistCache.ts';
import * as logic from '../src/services/routePreparationLogic.ts';

function evaluate(file, deps) {
  const exports = {};
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } });
  vm.runInNewContext(outputText, { exports, require(name) {
    assert.ok(name in deps, `Unexpected dependency ${name}`);
    return deps[name];
  } });
  return exports;
}

function setup() {
  cache.clearPricelistCaches();
  let online = true;
  let fail = false;
  const requests = [];
  const products = [{ id: 10, list_price: 50 }];
  const stops = [
    { customer_id: 123, _pricelistId: 81 },
    { customer_id: 456, _pricelistId: null },
    { customer_id: 123, _pricelistId: 82 },
  ];
  const pricing = evaluate('src/services/pricelist.ts', {
    './pricelistCache': cache,
    './serverPricingEndpoint': {
      shouldTryServerPricingEndpoint: () => true,
      markServerPricingEndpointAvailable() {}, disableServerPricingEndpointIfMissing() {},
    },
    './api': { postRest: async (_path, payload) => {
      assert.ok(online, 'must not request prices offline');
      requests.push(payload);
      if (fail) throw new Error('network unavailable');
      return { ok: true, data: { prices: [{ product_id: 10,
        price_unit: payload.pricelist_id === 81 ? 42 : payload.pricelist_id === 82 ? 43 : 45 }] } };
    } },
  });
  const store = evaluate('src/stores/useRoutePreparationStore.ts', {
    zustand: { create: createStore },
    './useAuthStore': { useAuthStore: { getState: () => ({ isAuthenticated: true,
      companyId: 34, employeeId: 1, warehouseId: 2 }) } },
    './useRouteStore': { useRouteStore: { getState: () => ({ plan: { plan_id: 7 }, stops, loadPlan: async () => {} }) } },
    './useProductStore': { useProductStore: { getState: () => ({ products, loadProducts: async () => {} }) } },
    './useSyncStore': { useSyncStore: { getState: () => ({ isOnline: online }) } },
    './useEmployeeDayBundleStore': { useEmployeeDayBundleStore: { getState: () => ({ prepare: async () => {},
      access: { canStartRoute: true }, record: { bundle: { operational_date: '2026-09-09' } } }) } },
    '../services/pricelist': pricing,
    '../services/routePreparationLogic': logic,
    '../services/routePreparationPersistence': { saveRoutePreparationReceipt: async () => {} },
    '../services/offlineCache': { schedulePersistPriceCache() {} },
    '../utils/logger': { logInfo() {}, logWarn() {} },
  }).useRoutePreparationStore;
  return { store, products, stops, requests, setOnline: value => { online = value; }, setFail: value => { fail = value; } };
}

function assertOfflinePrices(ctx) {
  ctx.setOnline(false);
  // Same inputs used by ProductPicker before the first visit to each client.
  for (const [index, expected] of [[0, 42], [1, 45], [2, 43]]) {
    const stop = ctx.stops[index];
    assert.equal(cache.peekCachedCustomerPrices(stop.customer_id, ctx.products,
      { companyId: 34, fallbackPricelistId: stop._pricelistId })?.get(10), expected);
  }
  assert.equal(cache.peekCachedCustomerPrices(123, ctx.products,
    { companyId: 34, fallbackPricelistId: 99 }), null, 'never substitute another list');
}

test('prepare online then open client offline, including serialized cache restoration', async () => {
  const ctx = setup();
  await ctx.store.getState().prepareRouteData();
  assert.equal(ctx.store.getState().failures.length, 0);
  assertOfflinePrices(ctx);
  const saved = JSON.parse(JSON.stringify(cache.serializePriceCache()));
  cache.clearPricelistCaches();
  cache.hydratePriceCache(saved, Date.now());
  assertOfflinePrices(ctx);
});

test('retry of failed preparation warms the same client lists used by the picker', async () => {
  const ctx = setup();
  ctx.setFail(true);
  await ctx.store.getState().prepareRouteData();
  assert.equal(ctx.store.getState().failures.length, 2);
  ctx.setFail(false);
  await ctx.store.getState().retryFailures();
  assert.equal(ctx.store.getState().failures.length, 0);
  assertOfflinePrices(ctx);
});
