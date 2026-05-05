/**
 * Phase A — cache key stability tests.
 *
 * The single biggest pricing-cache bug pre-Phase-A was that the cache key
 * baked in the *entire* product list including volatile fields like
 * qty_available. Any catalog refresh would change product ordering or
 * stock and silently invalidate the cache, forcing a fresh round of
 * partner/pricelist RPCs every time the user opened ProductPicker.
 *
 * These tests pin down the contract of buildProductsSemanticHash /
 * buildPartnerCacheKey:
 *   - Stable across volatile-field changes (qty, image, ordering)
 *   - Sensitive to fields that actually affect price (list_price, categ_id)
 *   - Robust to many2one [id, name] tuples coming from Odoo
 *
 * Note: integration tests for in-flight dedupe / preload concurrency live
 * inline as TODOs because pricelist.ts pulls react-native via api.ts and
 * cannot be loaded from a plain node test runner. The dedupe Map keys
 * directly off buildPartnerCacheKey, so the tests below transitively
 * validate the dedupe contract: same semantic input → same key → same
 * deduped promise.
 */

import assert from 'node:assert/strict';

interface CacheModule {
  buildProductsSemanticHash: (products: any[]) => string;
  buildPartnerCacheKey: (
    partnerId: number,
    products: any[],
    options?: { companyId?: number | null; fallbackPricelistId?: number | null },
  ) => string;
  resetPricelistCachesForTests: () => void;
}

function testHashIgnoresVolatileFields(cache: CacheModule) {
  const a = [
    { id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1, qty_available: 50, image: 'x' },
    { id: 20, list_price: 200, product_tmpl_id: 6, categ_id: 1, qty_available: 0, image: 'y' },
  ];
  const b = [
    { id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1, qty_available: 0 },
    { id: 20, list_price: 200, product_tmpl_id: 6, categ_id: 1, qty_available: 999 },
  ];
  assert.equal(
    cache.buildProductsSemanticHash(a),
    cache.buildProductsSemanticHash(b),
    'qty_available / image must NOT affect the cache key',
  );
}

function testHashIsOrderIndependent(cache: CacheModule) {
  const a = [
    { id: 20, list_price: 200, product_tmpl_id: 6, categ_id: 1 },
    { id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1 },
  ];
  const b = [
    { id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1 },
    { id: 20, list_price: 200, product_tmpl_id: 6, categ_id: 1 },
  ];
  assert.equal(
    cache.buildProductsSemanticHash(a),
    cache.buildProductsSemanticHash(b),
    'product list order must NOT affect the cache key',
  );
}

function testHashChangesWhenListPriceChanges(cache: CacheModule) {
  const a = [{ id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1 }];
  const b = [{ id: 10, list_price: 110, product_tmpl_id: 5, categ_id: 1 }];
  assert.notEqual(
    cache.buildProductsSemanticHash(a),
    cache.buildProductsSemanticHash(b),
    'list_price IS pricing-relevant and MUST change the cache key',
  );
}

function testHashChangesWhenCategoryChanges(cache: CacheModule) {
  // categ_id and product_tmpl_id matter because pricelist rules can apply
  // at template/category level — moving a product to another category
  // could swap its rule.
  const a = [{ id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1 }];
  const b = [{ id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 2 }];
  assert.notEqual(
    cache.buildProductsSemanticHash(a),
    cache.buildProductsSemanticHash(b),
  );
}

function testPartnerCacheKeyIsolatesPartners(cache: CacheModule) {
  const products = [{ id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1 }];
  assert.notEqual(
    cache.buildPartnerCacheKey(1, products, { companyId: 34 }),
    cache.buildPartnerCacheKey(2, products, { companyId: 34 }),
  );
}

function testPartnerCacheKeyIsStableAcrossCalls(cache: CacheModule) {
  // Stability is the critical property for in-flight dedupe — two callers
  // for the same {partner, products, options} MUST produce the same key
  // so the second call hits the in-flight Map.
  const products = [{ id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1 }];
  const key1 = cache.buildPartnerCacheKey(99, products, { companyId: 34 });
  const key2 = cache.buildPartnerCacheKey(99, products, { companyId: 34 });
  assert.equal(key1, key2);
}

function testPartnerCacheKeyAcceptsMany2oneArrays(cache: CacheModule) {
  // product_tmpl_id often arrives as [id, name] tuple from /get_records.
  const a = [{ id: 10, list_price: 100, product_tmpl_id: [5, 'Foo'], categ_id: [1, 'Bar'] }];
  const b = [{ id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1 }];
  assert.equal(
    cache.buildProductsSemanticHash(a),
    cache.buildProductsSemanticHash(b),
    '[id, name] tuples must hash like raw ids',
  );
}

function testHashRoundsListPriceToCents(cache: CacheModule) {
  // 1.234 vs 1.235 → both round to 1.23 vs 1.24 — the cents matter for
  // pricing display but sub-cent jitter (e.g. backend re-marshalling)
  // would otherwise blow the cache. Document the rounding behavior.
  const a = [{ id: 10, list_price: 1.234, product_tmpl_id: 5, categ_id: 1 }];
  const b = [{ id: 10, list_price: 1.231, product_tmpl_id: 5, categ_id: 1 }];
  assert.equal(
    cache.buildProductsSemanticHash(a),
    cache.buildProductsSemanticHash(b),
    'sub-cent jitter on list_price must NOT bust the cache',
  );
}

function testHashIsCompanyAndFallbackAware(cache: CacheModule) {
  const products = [{ id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1 }];
  // Same partner+products but different company → different key.
  const k1 = cache.buildPartnerCacheKey(1, products, { companyId: 34 });
  const k2 = cache.buildPartnerCacheKey(1, products, { companyId: 99, fallbackPricelistId: 999 });
  assert.notEqual(k1, k2);
}

async function main() {
  const cache = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/pricelistCache.ts', import.meta.url).pathname
  ) as CacheModule;

  testHashIgnoresVolatileFields(cache);
  testHashIsOrderIndependent(cache);
  testHashChangesWhenListPriceChanges(cache);
  testHashChangesWhenCategoryChanges(cache);
  testPartnerCacheKeyIsolatesPartners(cache);
  testPartnerCacheKeyIsStableAcrossCalls(cache);
  testPartnerCacheKeyAcceptsMany2oneArrays(cache);
  testHashRoundsListPriceToCents(cache);
  testHashIsCompanyAndFallbackAware(cache);

  console.log('pricelist cache stability tests: ok');
}

void main();
