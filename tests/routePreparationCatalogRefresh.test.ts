import assert from 'node:assert/strict';
import test from 'node:test';

import * as routePreparationLogic from '../src/services/routePreparationLogic.ts';
import type { InventoryLoadResult } from '../src/services/legacyRefreshRunner.ts';

type CatalogProduct = {
  id: number;
  name: string;
};

type CatalogState = {
  products: CatalogProduct[];
  error: string | null;
  inventorySource: 'truck_stock' | 'stock_quant' | 'global_legacy' | null;
  loadedWarehouseId: number | null;
  fromCache: boolean;
  inventoryFreshness: 'authoritative' | 'cached' | 'unknown';
};

type RefreshRoutePreparationCatalog = (input: {
  warehouseId: number;
  loadAuthoritative: (warehouseId: number) => Promise<InventoryLoadResult>;
  readCatalog: () => CatalogState;
}) => Promise<
  | { ok: true; products: readonly CatalogProduct[] }
  | { ok: false; reason: string }
>;

function subject(): RefreshRoutePreparationCatalog {
  const candidate = Reflect.get(
    routePreparationLogic,
    'refreshRoutePreparationCatalog',
  );
  assert.equal(
    typeof candidate,
    'function',
    'route preparation must expose an authoritative catalog refresh boundary',
  );
  return candidate as RefreshRoutePreparationCatalog;
}

test('online route preparation replaces a non-empty stale catalog before pricing', async () => {
  const staleRemovedProduct = { id: 10, name: 'Producto retirado' };
  const retainedProduct = { id: 20, name: 'Producto vigente' };
  const newlyAvailableProduct = { id: 30, name: 'Producto nuevo' };
  const state: CatalogState = {
    products: [staleRemovedProduct, retainedProduct],
    error: null,
    inventorySource: 'truck_stock',
    loadedWarehouseId: 44,
    fromCache: true,
    inventoryFreshness: 'cached',
  };
  const loadCalls: number[] = [];

  const result = await subject()({
    warehouseId: 44,
    loadAuthoritative: async (warehouseId) => {
      loadCalls.push(warehouseId);
      state.products = [retainedProduct, newlyAvailableProduct];
      state.inventorySource = 'truck_stock';
      state.loadedWarehouseId = warehouseId;
      state.fromCache = false;
      state.inventoryFreshness = 'authoritative';
      return {
        ok: true,
        authoritative: true,
        warehouseId,
        source: 'truck_stock',
      };
    },
    readCatalog: () => state,
  });

  assert.deepEqual(loadCalls, [44], 'a populated cache must not skip the refresh');
  assert.deepEqual(result, {
    ok: true,
    products: [retainedProduct, newlyAvailableProduct],
  });
  assert.equal(
    result.ok && result.products.some((product) => product.id === staleRemovedProduct.id),
    false,
    'removed products must not be priced from the stale catalog',
  );
});

test('failed authoritative refresh keeps the useful cache but cannot report a pricing catalog', async () => {
  const cachedProduct = { id: 10, name: 'Producto en caché' };
  const state: CatalogState = {
    products: [cachedProduct],
    error: null,
    inventorySource: 'truck_stock',
    loadedWarehouseId: 44,
    fromCache: true,
    inventoryFreshness: 'cached',
  };

  const result = await subject()({
    warehouseId: 44,
    loadAuthoritative: async () => ({
      ok: false,
      authoritative: false,
      reason: 'network_error',
    }),
    readCatalog: () => state,
  });

  assert.deepEqual(result, { ok: false, reason: 'network_error' });
  assert.deepEqual(state.products, [cachedProduct]);
  assert.equal(state.inventoryFreshness, 'cached');
});

test('a superseded authoritative load cannot publish products from another context', async () => {
  const state: CatalogState = {
    products: [{ id: 90, name: 'Producto de otro almacén' }],
    error: null,
    inventorySource: 'stock_quant',
    loadedWarehouseId: 55,
    fromCache: false,
    inventoryFreshness: 'authoritative',
  };

  const result = await subject()({
    warehouseId: 44,
    loadAuthoritative: async () => ({
      ok: true,
      authoritative: true,
      warehouseId: 44,
      source: 'truck_stock',
    }),
    readCatalog: () => state,
  });

  assert.deepEqual(result, { ok: false, reason: 'catalog_not_authoritative' });
});

test('an authoritative empty catalog is an explicit preparation failure', async () => {
  const state: CatalogState = {
    products: [],
    error: null,
    inventorySource: 'truck_stock',
    loadedWarehouseId: 44,
    fromCache: false,
    inventoryFreshness: 'authoritative',
  };

  const result = await subject()({
    warehouseId: 44,
    loadAuthoritative: async () => ({
      ok: true,
      authoritative: true,
      warehouseId: 44,
      source: 'truck_stock',
    }),
    readCatalog: () => state,
  });

  assert.deepEqual(result, { ok: false, reason: 'empty_catalog' });
});
