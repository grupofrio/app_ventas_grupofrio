/**
 * Customer-specific pricelist service.
 *
 * Security migration (2026-08): precio Y pricelist_id del cliente se
 * resuelven SIEMPRE en el servidor vía `pricing/by_partner` (Api-Key +
 * token de empleado, acotado al empleado). El cliente ya NO lee
 * res.partner / product.pricelist / product.pricelist.item por ORM ni
 * usa una sesión Odoo privilegiada — ese camino (odooRpc/odooSession) fue
 * eliminado. Sin respuesta del endpoint, la degradación es explícita: sin
 * override de precio (se usa list_price) y sin pricelist_id resuelto (el
 * backend asigna el default del partner al crear la venta).
 */

import { DEFAULT_READ_TIMEOUT_MS, postRest } from './api';
import {
  disableServerPricingEndpointIfMissing,
  markServerPricingEndpointAvailable,
  shouldTryServerPricingEndpoint,
} from './serverPricingEndpoint';
import {
  DEFAULT_SALES_COMPANY_ID,
  buildPartnerCacheKey,
  cacheResolvedPartnerPricelistId,
  cacheCustomerPrices,
  getEffectiveSalesCompanyId,
  getCompanyFallbackPricelistId,
  isPricelistCompatibleWithCompany,
  peekResolvedPartnerPricelistId,
  peekCachedCustomerPrices,
  clearPricelistCaches as clearPartnerPricelistCaches,
} from './pricelistCache';

// ── Dev-only logging helper (D) ─────────────────────────────────────────────
// Pricing/pricelist logs are noisy on devices in production. Wrap with
// __DEV__ so production builds drop them entirely. console.warn is preserved
// (real errors must remain visible).
declare const __DEV__: boolean | undefined;
const isDev = typeof __DEV__ !== 'undefined' ? !!__DEV__ : true;
function pricelistDebug(...args: unknown[]): void {
  if (isDev) console.log(...args);
}

export {
  DEFAULT_SALES_COMPANY_ID,
  getEffectiveSalesCompanyId,
  peekCachedCustomerPrices,
  getCompanyFallbackPricelistId,
  isPricelistCompatibleWithCompany,
  peekResolvedPartnerPricelistId,
} from './pricelistCache';

/** Limpia todos los cachés de listas de precio (llamar tras re-login). */
export function clearPricelistCaches(): void {
  inFlightCustomerPrices.clear();
  clearPartnerPricelistCaches();
}

interface PricingOptions {
  companyId?: number | null;
  fallbackPricelistId?: number | null;
}

const GF_BASE = 'gf/logistics/api/employee';

/**
 * Fetch customer-specific prices AND the resolved pricelist_id from Odoo's
 * employee-scoped endpoint. Computes prices server-side using Odoo's native
 * pricelist engine, guaranteeing consistency with what Odoo itself would
 * calculate — and caches pricelist_id as a side effect so
 * getPartnerPricelistId/peekResolvedPartnerPricelistId can read it without
 * a second round trip.
 *
 * Returns Map<productId, customerPrice> or null if the endpoint is unavailable.
 */
async function fetchServerSidePrices(
  partnerId: number,
  products: Array<{ id: number; list_price: number }>,
  options?: PricingOptions,
): Promise<Map<number, number> | null> {
  if (!shouldTryServerPricingEndpoint()) return null;

  const productIds = products
    .map((product) => product.id)
    .filter((id) => typeof id === 'number' && Number.isFinite(id) && id > 0);
  if (partnerId <= 0 || productIds.length === 0) return null;

  const explicitPricelistId = typeof options?.fallbackPricelistId === 'number' && options.fallbackPricelistId > 0
    ? options.fallbackPricelistId
    : null;

  try {
    const payload: Record<string, unknown> = {
      partner_id: partnerId,
      product_ids: productIds,
    };
    if (explicitPricelistId) {
      payload.pricelist_id = explicitPricelistId;
    }

    const result = await postRest<any>(`${GF_BASE}/pricing/by_partner`, payload, {
      timeoutMs: DEFAULT_READ_TIMEOUT_MS,
    });
    const data = result?.data !== undefined ? result.data : result;

    const resolvedPricelistId = typeof data?.pricelist_id === 'number' && data.pricelist_id > 0
      ? data.pricelist_id
      : null;
    cacheResolvedPartnerPricelistId(partnerId, resolvedPricelistId, options);

    const rawPrices = data?.prices ?? data?.price_map ?? data?.items ?? data;
    const productById = new Map(products.map((product) => [product.id, product]));
    const priceMap = new Map<number, number>();

    function addPrice(productId: unknown, price: unknown): void {
      if (typeof productId !== 'number' || !Number.isFinite(productId) || productId <= 0) return;
      if (typeof price !== 'number' || !Number.isFinite(price)) return;
      const product = productById.get(productId);
      if (!product) return;
      if (Math.abs(price - product.list_price) > 0.01) {
        priceMap.set(productId, price);
      }
    }

    if (Array.isArray(rawPrices)) {
      rawPrices.forEach((row) => {
        addPrice(
          row?.product_id ?? row?.id,
          row?.price ?? row?.price_unit ?? row?.unit_price,
        );
      });
    } else if (rawPrices && typeof rawPrices === 'object') {
      Object.entries(rawPrices).forEach(([productId, price]) => {
        addPrice(Number(productId), price);
      });
    } else {
      return null;
    }

    markServerPricingEndpointAvailable();
    return priceMap;
  } catch (error) {
    if (__DEV__) console.warn('[pricelist] pricing/by_partner unavailable, falling back:', error);
    disableServerPricingEndpointIfMissing(error);
    return null;
  }
}

/**
 * Resuelve el pricelist_id del cliente para adjuntarlo a la venta.
 *
 * Server-only: se apoya en el mismo `pricing/by_partner` (cacheado como
 * efecto secundario de fetchServerSidePrices/computeCustomerPrices). Si no
 * hay productos que cotizar o el servidor no respondió, degrada
 * explícitamente a null — el backend asigna el pricelist por defecto del
 * partner al crear la venta, nunca se adivina localmente.
 */
export async function getPartnerPricelistId(
  partnerId: number,
  products: Array<{ id: number; list_price: number }>,
  options?: PricingOptions,
): Promise<number | null> {
  if (products.length > 0) {
    await computeCustomerPrices(partnerId, products, options);
  }
  return peekResolvedPartnerPricelistId(partnerId, options);
}

/**
 * Compute customer-specific prices for a list of products.
 *
 * Server-only (pricing/by_partner). Sin respuesta del servidor, el mapa
 * queda vacío — todos los productos usan list_price. Nunca se calcula
 * localmente con reglas de pricelist leídas por ORM.
 *
 * Returns Map<productId, finalPrice> — only products with price
 * overrides are in the map. Products NOT in the map use list_price.
 */
// ── In-flight dedupe (A) ──────────────────────────────────────────────────
// Multiple concurrent callers (Home preload + ProductPicker open) for the
// same {partner, product set} would each kick a full RPC chain. Track the
// in-flight Promise keyed on the same semantic cache key and return it.
// We DO NOT cache rejected promises — the entry is removed in finally so the
// next caller can retry cleanly.
const inFlightCustomerPrices = new Map<string, Promise<Map<number, number>>>();

export function _peekInFlightCustomerPricesForTests(
  partnerId: number,
  products: Array<{ id: number; list_price?: number | null; product_tmpl_id?: any; categ_id?: any }>,
  options?: PricingOptions,
): boolean {
  return inFlightCustomerPrices.has(buildPartnerCacheKey(partnerId, products, options));
}

export async function computeCustomerPrices(
  partnerId: number,
  products: Array<{ id: number; list_price: number; product_tmpl_id?: any; categ_id?: any; standard_price?: number }>,
  options?: PricingOptions,
): Promise<Map<number, number>> {
  // Cache hit short-circuit — sync, no in-flight needed.
  const cachedPrices = peekCachedCustomerPrices(partnerId, products, options);
  if (cachedPrices) {
    pricelistDebug(`[pricelist] cache HIT partner=${partnerId} products=${products.length}`);
    return cachedPrices;
  }

  // In-flight dedupe — return the same Promise to all concurrent callers.
  const inFlightKey = buildPartnerCacheKey(partnerId, products, options);
  const existing = inFlightCustomerPrices.get(inFlightKey);
  if (existing) {
    pricelistDebug(`[pricelist] in-flight HIT partner=${partnerId}`);
    return existing.then((m) => new Map(m));
  }

  const startMs = isDev ? Date.now() : 0;
  pricelistDebug(`[pricelist] cache MISS partner=${partnerId} products=${products.length}`);

  const promise = _computeCustomerPricesUncached(partnerId, products, options)
    .then((result) => {
      if (isDev) {
        pricelistDebug(
          `[pricelist] computed partner=${partnerId} products=${products.length} overrides=${result.size} duration=${Date.now() - startMs}ms`,
        );
      }
      return result;
    })
    .finally(() => {
      // Always clean — never cache a rejected/in-flight entry.
      inFlightCustomerPrices.delete(inFlightKey);
    });

  inFlightCustomerPrices.set(inFlightKey, promise);
  // Return a defensive copy so callers cannot mutate the in-flight Map.
  return promise.then((m) => new Map(m));
}

async function _computeCustomerPricesUncached(
  partnerId: number,
  products: Array<{ id: number; list_price: number; product_tmpl_id?: any; categ_id?: any; standard_price?: number }>,
  options?: PricingOptions,
): Promise<Map<number, number>> {
  const serverPrices = await fetchServerSidePrices(partnerId, products, options);
  if (serverPrices !== null) {
    cacheCustomerPrices(partnerId, products, serverPrices, options);
    return serverPrices;
  }

  // Degradación explícita: sin servidor, sin overrides — list_price para
  // todos los productos. No hay fallback ORM/sesión privilegiada.
  const emptyPriceMap = new Map<number, number>();
  cacheCustomerPrices(partnerId, products, emptyPriceMap, options);
  return emptyPriceMap;
}

/**
 * Preload customer-specific prices for a route, with bounded concurrency.
 *
 * Why a concurrency cap: firing 20+ pricing/by_partner calls in parallel
 * saturates the network and makes the ProductPicker's own request queue
 * behind them. A small cap keeps each individual request fast and leaves
 * headroom for foreground work.
 *
 * Skips:
 *   - duplicate partnerIds
 *   - non-positive ids
 *   - partners already cached (peekCachedCustomerPrices)
 *   - partners already in-flight (computeCustomerPrices reuses the promise)
 */
const PRELOAD_CONCURRENCY = 4;

export async function preloadRouteCustomerPrices(
  partnerIds: number[],
  products: Array<{ id: number; list_price: number; product_tmpl_id?: any; categ_id?: any; standard_price?: number }>,
  options?: PricingOptions,
): Promise<void> {
  const uniquePartnerIds = [...new Set(partnerIds.filter((id) => typeof id === 'number' && id > 0))];
  if (uniquePartnerIds.length === 0 || products.length === 0) return;

  // Skip partners already cached or already in-flight — preload should never
  // duplicate work the foreground (or another preload) is already doing.
  const pending = uniquePartnerIds.filter((partnerId) => {
    if (peekCachedCustomerPrices(partnerId, products, options)) return false;
    if (_peekInFlightCustomerPricesForTests(partnerId, products, options)) return false;
    return true;
  });

  if (pending.length === 0) return;
  pricelistDebug(
    `[pricelist] preload pending=${pending.length}/${uniquePartnerIds.length} concurrency=${PRELOAD_CONCURRENCY}`,
  );

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const idx = cursor++;
      const partnerId = pending[idx];
      try {
        await computeCustomerPrices(partnerId, products, options);
      } catch {
        // Swallow — preload is best-effort. Real failures surface when
        // ProductPicker does its own (now in-flight-deduped) fetch.
      }
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(PRELOAD_CONCURRENCY, pending.length);
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
}
