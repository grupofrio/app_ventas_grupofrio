export const DEFAULT_SALES_COMPANY_ID = 34;

export const COMPANY_PRICELIST_FALLBACKS: Record<number, number> = {
  34: 104,
};

export function getEffectiveSalesCompanyId(companyId: number | null | undefined): number {
  if (typeof companyId === 'number' && companyId > 0) return companyId;
  return DEFAULT_SALES_COMPANY_ID;
}

export function getCompanyFallbackPricelistId(companyId: number | null | undefined): number | null {
  const effectiveCompanyId = getEffectiveSalesCompanyId(companyId);
  return COMPANY_PRICELIST_FALLBACKS[effectiveCompanyId] ?? null;
}

export function isPricelistCompatibleWithCompany(
  pricelistCompanyId: number | null | undefined,
  companyId: number | null | undefined,
): boolean {
  if (typeof pricelistCompanyId !== 'number' || pricelistCompanyId <= 0) return true;
  if (typeof companyId !== 'number' || companyId <= 0) return true;
  return pricelistCompanyId === companyId;
}

type CacheOptions = {
  companyId?: number | null;
  fallbackPricelistId?: number | null;
};

/**
 * Perf Fase 1: TTL del caché de precios por cliente extendido de 5 min a una
 * JORNADA operativa (10 h). Razón: los precios de lista/pricelist son estables
 * intradía; un TTL de 5 min hacía que en ruta sin señal el ProductPicker
 * re-disparara un RPC que cuelga hasta 45 s (DEFAULT_FETCH_TIMEOUT_MS). Con TTL
 * de jornada, `peekCachedCustomerPrices` sirve los precios precargados en el
 * CEDIS toda la ruta sin esperar la red.
 *
 * Seguridad: el caché es solo para LECTURA/visualización en el picker. La venta
 * sigue siendo online-first y el BACKEND es la fuente final de verdad de
 * precios e inventario al confirmar la venta. No habilita venta offline.
 * Nota: caché en memoria; se invalida al re-preparar ruta (catálogo nuevo
 * cambia el cache key) y al reiniciar la app (persistirlo es Fase 2).
 */
export const CUSTOMER_PRICE_CACHE_TTL_MS = 10 * 60 * 60 * 1000;

/**
 * Shape of a product as it participates in pricing cache keys.
 * Only fields that *affect price computation* must be in the hash.
 * Volatile fields (qty_available, image, ordering) MUST NOT be included or
 * cache keys would change on every catalog refresh, defeating the cache.
 */
export type PricingProductLike = {
  id: number;
  list_price?: number | null;
  product_tmpl_id?: any;
  categ_id?: any;
};

function normalizeFallbackPricelistId(options?: CacheOptions): number | null {
  if (typeof options?.fallbackPricelistId === 'number' && options.fallbackPricelistId > 0) {
    return options.fallbackPricelistId;
  }
  return getCompanyFallbackPricelistId(options?.companyId);
}

function extractIdLike(value: any): number | null {
  if (typeof value === 'number' && value > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'number' && value[0] > 0) return value[0];
  return null;
}

/**
 * Build a deterministic semantic hash for the product list used in pricing.
 * Only includes id, list_price, product_tmpl_id, categ_id. Sorted by id so
 * the input order does NOT affect the cache key.
 */
export function buildProductsSemanticHash(products: Array<PricingProductLike>): string {
  const normalized = products
    .filter((p) => p && typeof p.id === 'number' && p.id > 0)
    .map((p) => {
      const list = typeof p.list_price === 'number' && Number.isFinite(p.list_price)
        ? Math.round(p.list_price * 100) / 100
        : 0;
      const tmpl = extractIdLike(p.product_tmpl_id) ?? 0;
      const categ = extractIdLike(p.categ_id) ?? 0;
      return `${p.id}:${list}:${tmpl}:${categ}`;
    })
    .sort();
  return normalized.join(',');
}

export function buildPartnerCacheKey(
  partnerId: number,
  products: Array<PricingProductLike>,
  options?: CacheOptions,
): string {
  return [
    partnerId,
    normalizeFallbackPricelistId(options) ?? 0,
    buildProductsSemanticHash(products),
  ].join('|');
}

type CustomerPriceCacheEntry = {
  prices: Map<number, number>;
  cachedAtMs: number;
};

const partnerPriceCache = new Map<string, CustomerPriceCacheEntry>();
const partnerPricelistIdCache = new Map<string, number | null>();

export function peekCachedCustomerPrices(
  partnerId: number,
  products: Array<PricingProductLike>,
  options?: CacheOptions,
): Map<number, number> | null {
  const key = buildPartnerCacheKey(partnerId, products, options);
  const cached = partnerPriceCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAtMs > CUSTOMER_PRICE_CACHE_TTL_MS) {
    partnerPriceCache.delete(key);
    return null;
  }
  return new Map(cached.prices);
}

export function cacheCustomerPrices(
  partnerId: number,
  products: Array<PricingProductLike>,
  prices: Map<number, number>,
  options?: CacheOptions,
): void {
  const key = buildPartnerCacheKey(partnerId, products, options);
  partnerPriceCache.set(key, {
    prices: new Map(prices),
    cachedAtMs: Date.now(),
  });
}

function buildPartnerPricelistKey(partnerId: number, options?: CacheOptions): string {
  return [
    partnerId,
    normalizeFallbackPricelistId(options) ?? 0,
  ].join('|');
}

export function cacheResolvedPartnerPricelistId(
  partnerId: number,
  pricelistId: number | null,
  options?: CacheOptions,
): void {
  partnerPricelistIdCache.set(buildPartnerPricelistKey(partnerId, options), pricelistId);
}

export function peekResolvedPartnerPricelistId(
  partnerId: number,
  options?: CacheOptions,
): number | null {
  const key = buildPartnerPricelistKey(partnerId, options);
  return partnerPricelistIdCache.has(key) ? (partnerPricelistIdCache.get(key) ?? null) : null;
}

export function primeCustomerPriceCacheForTests(
  partnerId: number,
  products: Array<PricingProductLike>,
  prices: Array<[number, number]>,
  options?: CacheOptions,
): void {
  cacheCustomerPrices(partnerId, products, new Map(prices), options);
}

export function clearPricelistCaches(): void {
  partnerPriceCache.clear();
  partnerPricelistIdCache.clear();
}

export function resetPricelistCachesForTests(): void {
  clearPricelistCaches();
}
