/**
 * Perf Fase 2B — serialización/rehidratación del caché de precios por cliente.
 *
 * El caché de precios vive en memoria y se pierde al reiniciar la app. 2B lo
 * serializa a disco y lo rehidrata en boot. Estas pruebas validan el contrato
 * PURO (sin AsyncStorage) de serializePriceCache / hydratePriceCache:
 *   - los precios sobreviven un "restart" simulado (serialize → clear → hydrate)
 *   - una entrada vencida (más vieja que el TTL de jornada) NO se rehidrata
 *   - datos corruptos no crashean (devuelve 0)
 *   - el pricelistId por cliente también hace round-trip
 */

import assert from 'node:assert/strict';

interface Mod {
  CUSTOMER_PRICE_CACHE_TTL_MS: number;
  cacheCustomerPrices: (
    partnerId: number,
    products: any[],
    prices: Map<number, number>,
    options?: { companyId?: number | null; fallbackPricelistId?: number | null },
  ) => void;
  peekCachedCustomerPrices: (
    partnerId: number,
    products: any[],
    options?: { companyId?: number | null; fallbackPricelistId?: number | null },
  ) => Map<number, number> | null;
  cacheResolvedPartnerPricelistId: (
    partnerId: number,
    pricelistId: number | null,
    options?: { companyId?: number | null; fallbackPricelistId?: number | null },
  ) => void;
  peekResolvedPartnerPricelistId: (
    partnerId: number,
    options?: { companyId?: number | null; fallbackPricelistId?: number | null },
  ) => number | null;
  serializePriceCache: () => any;
  hydratePriceCache: (data: unknown, nowMs: number) => number;
  resetPricelistCachesForTests: () => void;
}

const PRODUCTS = [{ id: 10, list_price: 100, product_tmpl_id: 5, categ_id: 1 }];
const OPTS = { companyId: 34 };

function testPricesSurviveRestart(m: Mod) {
  const realNow = Date.now;
  try {
    Date.now = () => 1_000;
    m.cacheCustomerPrices(99, PRODUCTS, new Map([[10, 80]]), OPTS);
    m.cacheResolvedPartnerPricelistId(99, 104, OPTS);

    // Serializa (lo que iría a disco) y simula reinicio limpiando memoria.
    const dump = m.serializePriceCache();
    m.resetPricelistCachesForTests();
    assert.equal(m.peekCachedCustomerPrices(99, PRODUCTS, OPTS), null, 'tras reset no debe haber nada');

    // Rehidrata "poco después" (dentro del TTL).
    const restored = m.hydratePriceCache(dump, 1_000 + 60_000);
    assert.equal(restored, 1, 'debe restaurar 1 entrada de precios');

    const prices = m.peekCachedCustomerPrices(99, PRODUCTS, OPTS);
    assert.deepEqual([...(prices ?? new Map()).entries()], [[10, 80]], 'precios sobreviven el restart');
    assert.equal(m.peekResolvedPartnerPricelistId(99, OPTS), 104, 'pricelistId también hace round-trip');
  } finally {
    Date.now = realNow;
    m.resetPricelistCachesForTests();
  }
}

function testStaleEntriesDropped(m: Mod) {
  const realNow = Date.now;
  try {
    Date.now = () => 1_000;
    m.cacheCustomerPrices(99, PRODUCTS, new Map([[10, 80]]), OPTS);
    const dump = m.serializePriceCache();
    m.resetPricelistCachesForTests();

    // Rehidrata DESPUÉS del TTL → la entrada está vencida y se descarta.
    const restored = m.hydratePriceCache(dump, 1_000 + m.CUSTOMER_PRICE_CACHE_TTL_MS + 1);
    assert.equal(restored, 0, 'entrada vencida no se rehidrata');
    assert.equal(m.peekCachedCustomerPrices(99, PRODUCTS, OPTS), null);
  } finally {
    Date.now = realNow;
    m.resetPricelistCachesForTests();
  }
}

function testCorruptDoesNotCrash(m: Mod) {
  for (const bad of [null, undefined, 42, 'str', {}, { prices: 'x' }, { prices: [null, 1, { key: 5 }] }]) {
    const restored = m.hydratePriceCache(bad, 1_000);
    assert.equal(restored, 0, `corrupto ${JSON.stringify(bad)} → 0 sin lanzar`);
  }
  // Entradas con pares malformados se ignoran individualmente.
  const partial = {
    prices: [
      { key: 'k1', cachedAtMs: 1_000, prices: [[10, 80], ['x', 5], [20]] },
    ],
    pricelistIds: [{ key: 'k1', pricelistId: 'nope' }],
  };
  const restored = m.hydratePriceCache(partial, 1_500);
  assert.equal(restored, 1, 'la entrada válida se restaura aunque tenga pares basura');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/pricelistCache.ts', import.meta.url).pathname
  ) as Mod;
  m.resetPricelistCachesForTests();
  testPricesSurviveRestart(m);
  testStaleEntriesDropped(m);
  testCorruptDoesNotCrash(m);
  console.log('price cache persistence tests: ok');
}
void main();
