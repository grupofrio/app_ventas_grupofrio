import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_RECENT_PRODUCTS_PER_CONTEXT,
  upsertRecentProducts,
  type RecentProductSnapshot,
} from '../src/services/recentProductIndex.ts';

function recentProduct(
  productId: number,
  lastSeenAtMs: number,
  overrides: Partial<RecentProductSnapshot> = {},
): RecentProductSnapshot {
  return {
    productId,
    name: `Producto ${productId}`,
    defaultCode: `SKU-${productId}`,
    listPrice: productId * 10,
    weight: 1,
    lastSeenAtMs,
    ...overrides,
  };
}

test('inserts recent products in deterministic newest-first order', () => {
  const result = upsertRecentProducts([], [
    recentProduct(20, 2_000),
    recentProduct(10, 3_000),
    recentProduct(30, 2_000),
  ]);

  assert.deepEqual(result.map(({ productId }) => productId), [10, 20, 30]);
});

test('refreshes duplicate metadata and last-seen time without mutating inputs', () => {
  const existing = [recentProduct(10, 1_000, {
    name: 'Nombre anterior',
    listPrice: 50,
  })];
  const incoming = [recentProduct(10, 3_000, {
    name: 'Nombre nuevo',
    defaultCode: null,
    listPrice: 75,
    weight: 2,
  })];
  const before = structuredClone({ existing, incoming });

  const result = upsertRecentProducts(existing, incoming);

  assert.deepEqual(result, [{
    productId: 10,
    name: 'Nombre nuevo',
    defaultCode: null,
    listPrice: 75,
    weight: 2,
    lastSeenAtMs: 3_000,
  }]);
  assert.deepEqual({ existing, incoming }, before);
  assert.notStrictEqual(result[0], existing[0]);
  assert.notStrictEqual(result[0], incoming[0]);
});

test('never regresses lastSeenAtMs when an older duplicate arrives', () => {
  const result = upsertRecentProducts(
    [recentProduct(10, 5_000, { name: 'Anterior' })],
    [recentProduct(10, 2_000, { name: 'Metadato actualizado' })],
  );

  assert.equal(result[0]?.lastSeenAtMs, 5_000);
  assert.equal(result[0]?.name, 'Metadato actualizado');
});

test('resolves duplicate input deterministically independent of input order', () => {
  const alpha = recentProduct(10, 2_000, {
    name: 'Alpha',
    listPrice: 10,
  });
  const zeta = recentProduct(10, 2_000, {
    name: 'Zeta',
    listPrice: 20,
  });

  const forward = upsertRecentProducts([], [alpha, zeta]);
  const backward = upsertRecentProducts([], [zeta, alpha]);

  assert.deepEqual(backward, forward);
});

test('keeps exact contexts isolated because each invocation owns one context index', () => {
  const north = upsertRecentProducts(
    [recentProduct(10, 1_000)],
    [recentProduct(20, 2_000)],
  );
  const south = upsertRecentProducts(
    [recentProduct(10, 1_000)],
    [recentProduct(30, 3_000)],
  );

  assert.deepEqual(north.map(({ productId }) => productId), [20, 10]);
  assert.deepEqual(south.map(({ productId }) => productId), [30, 10]);
  assert.equal(north.some(({ productId }) => productId === 30), false);
  assert.equal(south.some(({ productId }) => productId === 20), false);
});

test('retains at most 100 entries per invocation context', () => {
  const incoming = Array.from(
    { length: MAX_RECENT_PRODUCTS_PER_CONTEXT + 5 },
    (_, index) => recentProduct(index + 1, index + 1),
  );

  const result = upsertRecentProducts([], incoming);

  assert.equal(result.length, 100);
  assert.deepEqual(
    result.map(({ productId }) => productId),
    Array.from({ length: 100 }, (_, index) => 105 - index),
  );
});

test('evicts the lowest product ID first when oldest timestamps tie', () => {
  const existing = Array.from(
    { length: MAX_RECENT_PRODUCTS_PER_CONTEXT },
    (_, index) => recentProduct(index + 1, 1_000),
  );

  const result = upsertRecentProducts(existing, [recentProduct(101, 1_000)]);

  assert.equal(result.length, 100);
  assert.equal(result.some(({ productId }) => productId === 1), false);
  assert.equal(result.some(({ productId }) => productId === 2), true);
  assert.equal(result.some(({ productId }) => productId === 101), true);
});

test('drops malformed identities and unsafe new entries without throwing', () => {
  const malformed = [
    null,
    'not-a-product',
    recentProduct(0, 1_000),
    recentProduct(-1, 1_000),
    recentProduct(1.5, 1_000),
    recentProduct(10, Number.NaN),
    { productId: '20', lastSeenAtMs: 2_000 },
  ] as unknown as RecentProductSnapshot[];

  assert.doesNotThrow(() => upsertRecentProducts(malformed, malformed));
  assert.deepEqual(upsertRecentProducts(malformed, malformed), []);
});

test('treats malformed index containers as empty without throwing', () => {
  assert.doesNotThrow(() => upsertRecentProducts(
    { not: 'an array' } as never,
    'not-an-array' as never,
  ));
  assert.deepEqual(upsertRecentProducts(
    { not: 'an array' } as never,
    'not-an-array' as never,
  ), []);
});

test('normalizes new metadata to safe string and numeric values', () => {
  const result = upsertRecentProducts([], [{
    productId: 10,
    name: '   ',
    defaultCode: '  SKU-10  ',
    listPrice: Number.POSITIVE_INFINITY,
    weight: -5,
    lastSeenAtMs: 1_000,
  }]);

  assert.deepEqual(result, [{
    productId: 10,
    name: 'Producto 10',
    defaultCode: 'SKU-10',
    listPrice: 0,
    weight: 0,
    lastSeenAtMs: 1_000,
  }]);
});
