import assert from 'node:assert/strict';
import test from 'node:test';

import { STORAGE_KEYS } from '../src/persistence/storage.ts';
import {
  buildOfflineCatalogContext,
  buildOfflineCatalogContextIdentity,
  createOfflineCatalogRepository,
  type LastKnownCatalogSnapshot,
  type OfflineCatalogStorage,
} from '../src/services/offlineCatalogRepository.ts';
import type { RecentProductSnapshot } from '../src/services/recentProductIndex.ts';

function product(id: number): LastKnownCatalogSnapshot['products'][number] {
  return {
    id,
    name: `Producto ${id}`,
    default_code: `SKU-${id}`,
    list_price: id * 10,
    qty_available: id,
    sale_ok: true,
    product_tmpl_id: [id + 1_000, `Plantilla ${id}`],
    weight: 1,
    categ_id: false,
    _totalKg: id,
    qty_reserved: 0,
    qty_display: id,
    _isGlobalFallback: false,
  };
}

function snapshot(
  overrides: Partial<LastKnownCatalogSnapshot> = {},
): LastKnownCatalogSnapshot {
  return {
    version: 1,
    companyId: 20,
    employeeId: 10,
    warehouseId: 30,
    mobileLocationId: 40,
    fetchedAtMs: 1_000,
    inventorySource: 'truck_stock',
    hasStockData: true,
    products: [product(1)],
    ...overrides,
  };
}

function recent(
  productId: number,
  lastSeenAtMs = productId,
): RecentProductSnapshot {
  return {
    productId,
    name: `Producto ${productId}`,
    defaultCode: `SKU-${productId}`,
    listPrice: productId * 10,
    weight: 1,
    lastSeenAtMs,
  };
}

class MemoryStorage implements OfflineCatalogStorage {
  readonly loads: string[] = [];
  readonly saves: string[] = [];
  readonly values = new Map<string, unknown>();
  failNextSave = false;
  failLoads = false;

  async load(key: string): Promise<unknown> {
    this.loads.push(key);
    if (this.failLoads) throw new Error('read failed');
    const value = this.values.get(key);
    return value === undefined ? null : structuredClone(value);
  }

  async saveStrict(key: string, value: unknown): Promise<void> {
    this.saves.push(key);
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('write failed');
    }
    this.values.set(key, structuredClone(value));
  }
}

test('builds the exact defensive auth context without a day component', () => {
  const context = buildOfflineCatalogContext({
    employeeId: 10,
    companyId: 20,
    warehouseId: 30,
    mobileLocationId: null,
  });
  const nextDayContext = buildOfflineCatalogContext({
    employeeId: 10,
    companyId: 20,
    warehouseId: 30,
    mobileLocationId: null,
  });

  assert.deepEqual(context, {
    employeeId: 10,
    companyId: 20,
    warehouseId: 30,
    mobileLocationId: null,
  });
  assert.equal(
    buildOfflineCatalogContextIdentity(context),
    buildOfflineCatalogContextIdentity(nextDayContext),
  );
  assert.equal(buildOfflineCatalogContextIdentity(context).includes('2026'), false);

  assert.deepEqual(buildOfflineCatalogContext({
    employeeId: -1,
    companyId: Number.MAX_SAFE_INTEGER + 1,
    warehouseId: 3.5,
    mobileLocationId: 0,
  } as never), {
    employeeId: null,
    companyId: null,
    warehouseId: null,
    mobileLocationId: null,
  });
});

test('uses a deterministic collision-safe identity containing every context field', () => {
  const base = buildOfflineCatalogContextIdentity({
    employeeId: 1,
    companyId: 23,
    warehouseId: 4,
    mobileLocationId: null,
  });
  const wouldCollideIfConcatenated = buildOfflineCatalogContextIdentity({
    employeeId: 12,
    companyId: 3,
    warehouseId: 4,
    mobileLocationId: null,
  });
  const differentMobile = buildOfflineCatalogContextIdentity({
    employeeId: 1,
    companyId: 23,
    warehouseId: 4,
    mobileLocationId: 9,
  });

  assert.notEqual(base, wouldCollideIfConcatenated);
  assert.notEqual(base, differentMobile);
  assert.equal(base, JSON.stringify([1, 23, 4, null]));
});

test('persists last-known snapshots by exact context and reads them on a later day', async () => {
  const storage = new MemoryStorage();
  const repository = createOfflineCatalogRepository(storage);
  const saved = snapshot();
  const matchingContext = buildOfflineCatalogContext(saved);

  await repository.saveLastKnownCatalogStrict(saved);
  saved.products[0]!.name = 'mutated after save';

  const loaded = await repository.loadLastKnownCatalog(matchingContext);
  assert.equal(loaded?.products[0]?.name, 'Producto 1');
  assert.deepEqual(storage.loads, [
    STORAGE_KEYS.LAST_KNOWN_CATALOG,
    STORAGE_KEYS.LAST_KNOWN_CATALOG,
  ]);
  assert.deepEqual(storage.saves, [STORAGE_KEYS.LAST_KNOWN_CATALOG]);

  assert.equal(await repository.loadLastKnownCatalog({
    ...matchingContext,
    employeeId: 11,
  }), null);
  assert.equal(await repository.loadLastKnownCatalog({
    ...matchingContext,
    companyId: 21,
  }), null);
  assert.equal(await repository.loadLastKnownCatalog({
    ...matchingContext,
    warehouseId: 31,
  }), null);
  assert.equal(await repository.loadLastKnownCatalog({
    ...matchingContext,
    mobileLocationId: 41,
  }), null);
});

test('retains multiple contexts in one base key without overwriting them', async () => {
  const storage = new MemoryStorage();
  const repository = createOfflineCatalogRepository(storage);
  const north = snapshot({ warehouseId: 30, products: [product(1)] });
  const south = snapshot({ warehouseId: 31, products: [product(2)] });

  await Promise.all([
    repository.saveLastKnownCatalogStrict(north),
    repository.saveLastKnownCatalogStrict(south),
  ]);

  assert.deepEqual(
    (await repository.loadLastKnownCatalog(buildOfflineCatalogContext(north)))
      ?.products.map(({ id }) => id),
    [1],
  );
  assert.deepEqual(
    (await repository.loadLastKnownCatalog(buildOfflineCatalogContext(south)))
      ?.products.map(({ id }) => id),
    [2],
  );
});

test('ignores corrupt and version-mismatched data without deleting or throwing', async () => {
  const storage = new MemoryStorage();
  const repository = createOfflineCatalogRepository(storage);
  const context = buildOfflineCatalogContext(snapshot());

  storage.values.set(STORAGE_KEYS.LAST_KNOWN_CATALOG, '{broken');
  assert.equal(await repository.loadLastKnownCatalog(context), null);
  assert.equal(storage.saves.length, 0);

  storage.values.set(STORAGE_KEYS.LAST_KNOWN_CATALOG, {
    version: 2,
    records: {},
  });
  assert.equal(await repository.loadLastKnownCatalog(context), null);
  assert.equal(storage.saves.length, 0);

  storage.failLoads = true;
  assert.equal(await repository.loadLastKnownCatalog(context), null);
  assert.deepEqual(await repository.loadRecentProducts(context), []);
});

test('a failed strict replacement leaves the prior last-known snapshot readable', async () => {
  const storage = new MemoryStorage();
  const repository = createOfflineCatalogRepository(storage);
  const original = snapshot({ fetchedAtMs: 1_000, products: [product(1)] });
  const replacement = snapshot({ fetchedAtMs: 2_000, products: [product(2)] });
  const context = buildOfflineCatalogContext(original);

  await repository.saveLastKnownCatalogStrict(original);
  storage.failNextSave = true;
  await assert.rejects(
    repository.saveLastKnownCatalogStrict(replacement),
    /write failed/,
  );

  assert.deepEqual(
    (await repository.loadLastKnownCatalog(context))?.products.map(({ id }) => id),
    [1],
  );
});

test('a strict save aborts on read failure instead of overwriting other contexts', async () => {
  const storage = new MemoryStorage();
  const repository = createOfflineCatalogRepository(storage);
  const north = snapshot({ warehouseId: 30, products: [product(1)] });
  const south = snapshot({ warehouseId: 31, products: [product(2)] });

  await repository.saveLastKnownCatalogStrict(north);
  const before = structuredClone(
    storage.values.get(STORAGE_KEYS.LAST_KNOWN_CATALOG),
  );
  storage.failLoads = true;

  await assert.rejects(
    repository.saveLastKnownCatalogStrict(south),
    /read failed/,
  );
  assert.deepEqual(
    storage.values.get(STORAGE_KEYS.LAST_KNOWN_CATALOG),
    before,
  );
  assert.equal(storage.saves.length, 1);
});

test('rejects invalid strict snapshots without replacing valid prior data', async () => {
  const storage = new MemoryStorage();
  const repository = createOfflineCatalogRepository(storage);
  const original = snapshot();

  await repository.saveLastKnownCatalogStrict(original);
  await assert.rejects(
    repository.saveLastKnownCatalogStrict(snapshot({
      fetchedAtMs: Number.NaN,
      products: [{ ...product(2), qty_display: Number.NaN }],
    })),
    /Invalid last-known catalog snapshot/,
  );

  assert.deepEqual(
    await repository.loadLastKnownCatalog(buildOfflineCatalogContext(original)),
    original,
  );
});

test('persists recent products per context with deterministic LRU limit 100', async () => {
  const storage = new MemoryStorage();
  const repository = createOfflineCatalogRepository(storage);
  const context = buildOfflineCatalogContext(snapshot());
  const otherContext = { ...context, mobileLocationId: 41 };
  const incoming = Array.from(
    { length: 105 },
    (_, index) => recent(index + 1, 1_000),
  );
  const before = structuredClone(incoming);

  await repository.saveRecentProductsStrict(context, incoming);
  await repository.saveRecentProductsStrict(otherContext, [recent(999, 9_999)]);

  const loaded = await repository.loadRecentProducts(context);
  assert.equal(loaded.length, 100);
  assert.equal(loaded.some(({ productId }) => productId === 1), false);
  assert.equal(loaded.some(({ productId }) => productId === 6), true);
  assert.equal(loaded.some(({ productId }) => productId === 105), true);
  assert.deepEqual(await repository.loadRecentProducts(otherContext), [recent(999, 9_999)]);
  assert.deepEqual(incoming, before);
  assert.ok(storage.saves.every((key) => key === STORAGE_KEYS.RECENT_PRODUCTS));
});

test('strict recent save rejects malformed entries and preserves the prior index', async () => {
  const storage = new MemoryStorage();
  const repository = createOfflineCatalogRepository(storage);
  const context = buildOfflineCatalogContext(snapshot());

  await repository.saveRecentProductsStrict(context, [recent(1, 1_000)]);
  await assert.rejects(
    repository.saveRecentProductsStrict(context, [
      recent(2, 2_000),
      { ...recent(3, 3_000), listPrice: Number.POSITIVE_INFINITY },
    ]),
    /Invalid recent product snapshot/,
  );

  assert.deepEqual(await repository.loadRecentProducts(context), [recent(1, 1_000)]);
});
