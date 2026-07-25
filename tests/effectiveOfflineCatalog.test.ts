import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEffectiveOfflineCatalog,
  type EffectiveOfflineProduct,
} from '../src/services/effectiveOfflineCatalog.ts';
import type { RecentProductSnapshot } from '../src/services/recentProductIndex.ts';

function truckProduct(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: `Producto ${id}`,
    default_code: `SKU-${id}`,
    list_price: id * 10,
    weight: id / 10,
    qty_display: id,
    ...overrides,
  };
}

function recentProduct(
  productId: number,
  overrides: Partial<RecentProductSnapshot> = {},
): RecentProductSnapshot {
  return {
    productId,
    name: `Producto reciente ${productId}`,
    defaultCode: `REC-${productId}`,
    listPrice: productId * 5,
    weight: 1,
    lastSeenAtMs: 1_000 + productId,
    ...overrides,
  };
}

test('unifies sources without duplicates using current, last-known, recent precedence', () => {
  const result = buildEffectiveOfflineCatalog({
    currentProducts: [
      truckProduct(40),
      truckProduct(10, { name: 'Actual 10' }),
    ],
    currentInventoryFreshness: 'authoritative',
    currentInventoryCapturedAtMs: 3_000,
    lastKnownProducts: [
      truckProduct(20, { name: 'Último 20' }),
      truckProduct(10, { name: 'Último 10' }),
    ],
    lastKnownInventoryCapturedAtMs: 2_000,
    recentProducts: [
      recentProduct(30, { name: 'Reciente 30' }),
      recentProduct(20, { name: 'Reciente 20' }),
    ],
  });

  assert.deepEqual(
    result.map(({ productId, origin, name }) => [productId, origin, name]),
    [
      [10, 'current', 'Actual 10'],
      [40, 'current', 'Producto 40'],
      [20, 'last_known', 'Último 20'],
      [30, 'recent', 'Reciente 30'],
    ],
  );
});

test('makes current inventory authoritative only when the caller explicitly says so', () => {
  const authoritative = buildEffectiveOfflineCatalog({
    currentProducts: [truckProduct(10)],
    currentInventoryFreshness: 'authoritative',
    currentInventoryCapturedAtMs: 3_000,
  });
  const cached = buildEffectiveOfflineCatalog({
    currentProducts: [truckProduct(10)],
    currentInventoryFreshness: 'cached',
    currentInventoryCapturedAtMs: 2_000,
  });
  const safeDefault = buildEffectiveOfflineCatalog({
    currentProducts: [truckProduct(10)],
  });

  assert.deepEqual(
    authoritative.map(({ inventoryFreshness, inventoryCapturedAtMs }) => [
      inventoryFreshness,
      inventoryCapturedAtMs,
    ]),
    [['authoritative', 3_000]],
  );
  assert.equal(cached[0]?.inventoryFreshness, 'cached');
  assert.equal(safeDefault[0]?.inventoryFreshness, 'cached');
});

test('always marks last-known inventory cached and recent-only inventory unknown', () => {
  const result = buildEffectiveOfflineCatalog({
    currentProducts: [],
    currentInventoryFreshness: 'authoritative',
    lastKnownProducts: [truckProduct(20)],
    lastKnownInventoryCapturedAtMs: 2_000,
    recentProducts: [recentProduct(30)],
  });

  assert.deepEqual(
    result.map(({ productId, inventoryFreshness, inventoryCapturedAtMs, qtyDisplay }) => ({
      productId,
      inventoryFreshness,
      inventoryCapturedAtMs,
      qtyDisplay,
    })),
    [
      {
        productId: 20,
        inventoryFreshness: 'cached',
        inventoryCapturedAtMs: 2_000,
        qtyDisplay: 20,
      },
      {
        productId: 30,
        inventoryFreshness: 'unknown',
        inventoryCapturedAtMs: null,
        qtyDisplay: null,
      },
    ],
  );
});

test('uses null quantity when inventory is absent instead of fabricating TruckProduct fields', () => {
  const [product] = buildEffectiveOfflineCatalog({
    currentProducts: [truckProduct(10, { qty_display: undefined })],
    currentInventoryFreshness: 'cached',
  });

  assert.equal(product?.qtyDisplay, null);
  assert.deepEqual(Object.keys(product ?? {}).sort(), [
    'defaultCode',
    'inventoryCapturedAtMs',
    'inventoryFreshness',
    'listPrice',
    'name',
    'origin',
    'productId',
    'qtyDisplay',
    'weight',
  ]);
  assert.equal('qty_available' in (product ?? {}), false);
  assert.equal('qty_reserved' in (product ?? {}), false);
  assert.equal('_totalKg' in (product ?? {}), false);
});

test('rejects invalid identities and normalizes malformed presentation values safely', () => {
  const result = buildEffectiveOfflineCatalog({
    currentProducts: [
      truckProduct(0),
      truckProduct(-1),
      truckProduct(1.5),
      truckProduct(10, {
        name: '   ',
        default_code: false,
        list_price: Number.POSITIVE_INFINITY,
        weight: -2,
        qty_display: Number.NaN,
      }),
      null,
      'not-a-product',
    ],
    currentInventoryFreshness: 'authoritative',
    currentInventoryCapturedAtMs: Number.NaN,
    lastKnownProducts: [{ id: '20' }],
    recentProducts: [
      recentProduct(30, {
        name: '  Producto seguro  ',
        defaultCode: '  REC-30  ',
      }),
    ],
  });

  assert.deepEqual(result, [
    {
      productId: 10,
      name: 'Producto 10',
      defaultCode: null,
      listPrice: 0,
      weight: 0,
      qtyDisplay: null,
      origin: 'current',
      inventoryFreshness: 'authoritative',
      inventoryCapturedAtMs: null,
    },
    {
      productId: 30,
      name: 'Producto seguro',
      defaultCode: 'REC-30',
      listPrice: 150,
      weight: 1,
      qtyDisplay: null,
      origin: 'recent',
      inventoryFreshness: 'unknown',
      inventoryCapturedAtMs: null,
    },
  ] satisfies EffectiveOfflineProduct[]);
});

test('treats malformed source containers as empty without throwing', () => {
  assert.doesNotThrow(() => buildEffectiveOfflineCatalog({
    currentProducts: { not: 'an array' } as never,
    lastKnownProducts: 'not-an-array' as never,
    recentProducts: 42 as never,
  }));
  assert.deepEqual(buildEffectiveOfflineCatalog({
    currentProducts: { not: 'an array' } as never,
    lastKnownProducts: 'not-an-array' as never,
    recentProducts: 42 as never,
  }), []);
});

test('returns a stable source-priority and product-id order without mutating inputs', () => {
  const currentProducts = [truckProduct(9), truckProduct(2)];
  const lastKnownProducts = [truckProduct(8), truckProduct(1)];
  const recentProducts = [recentProduct(7), recentProduct(3)];
  const before = structuredClone({
    currentProducts,
    lastKnownProducts,
    recentProducts,
  });

  const result = buildEffectiveOfflineCatalog({
    currentProducts,
    currentInventoryFreshness: 'cached',
    lastKnownProducts,
    recentProducts,
  });
  const reordered = buildEffectiveOfflineCatalog({
    currentProducts: [...currentProducts].reverse(),
    currentInventoryFreshness: 'cached',
    lastKnownProducts: [...lastKnownProducts].reverse(),
    recentProducts: [...recentProducts].reverse(),
  });

  assert.deepEqual(result.map(({ productId }) => productId), [2, 9, 1, 8, 3, 7]);
  assert.deepEqual(reordered, result);
  assert.deepEqual({ currentProducts, lastKnownProducts, recentProducts }, before);
});
