/**
 * BLD-20260409: Customer-specific pricelist service.
 *
 * Odoo price logic:
 *   product.product.list_price = PUBLIC price (tarifa publica)
 *   Each partner has property_product_pricelist → their specific pricelist
 *   Pricelist items define: fixed price, percentage discount, or formula
 *
 * Odoo 18: property_product_pricelist is a regular Many2one on res.partner
 * (ir.property was removed). The /get_records endpoint does NOT return Many2one
 * fields reliably — use odooRpc search_read or read to fetch them via native ORM.
 *
 * Strategy:
 *   1. Try odooRpc search_read on res.partner for pricelist_id / property_product_pricelist
 *   2. If that fails, try /get_records as fallback
 *   3. Load pricelist items and compute prices client-side
 */

import { odooRead, odooRpc } from './odooRpc';
import { postRpc } from './api';
import {
  buildPartnerPricelistCandidates,
  computeRulePrice,
  extractMany2oneId,
  getPreferredPartnerPricelistId,
} from './pricelistLogic';
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
  partnerPricelistResolutionCache.clear();
  pricelistItemsCache.clear();
  pricelistCompanyCache.clear();
  inFlightCustomerPrices.clear();
  clearPartnerPricelistCaches();
}

export interface PricelistItem {
  id: number;
  product_id: [number, string] | false;
  product_tmpl_id: [number, string] | false;
  categ_id: [number, string] | false;
  compute_price: 'fixed' | 'percentage' | 'formula';
  base?: 'list_price' | 'standard_price' | 'pricelist';
  base_pricelist_id?: [number, string] | false;
  fixed_price: number;
  percent_price: number;
  price_discount?: number;
  price_surcharge?: number;
  price_round?: number;
  price_min_margin?: number;
  price_max_margin?: number;
  min_quantity: number;
  applied_on: '0_product_variant' | '1_product' | '2_product_category' | '3_global';
}

const PRICELIST_ITEM_FIELDS = [
  'id', 'product_id', 'product_tmpl_id', 'categ_id',
  'compute_price', 'base', 'base_pricelist_id',
  'fixed_price', 'percent_price',
  'price_discount', 'price_surcharge', 'price_round',
  'price_min_margin', 'price_max_margin',
  'min_quantity', 'applied_on',
];

interface PartnerPricelistRecord {
  id: number;
  parent_id?: [number, string] | number | false;
  commercial_partner_id?: [number, string] | number | false;
  pricelist_id?: [number, string] | number | false;
  property_product_pricelist?: [number, string] | number | false;
}

interface PartnerPricelistResolution {
  candidatePartnerIds: number[];
  resolvedPartnerId: number | null;
  pricelistId: number | null;
  source: 'partner_field' | 'get_records' | 'company_fallback' | 'none';
}

interface PricingOptions {
  companyId?: number | null;
  fallbackPricelistId?: number | null;
}

function resolveFallbackPricelistId(options?: PricingOptions): number | null {
  if (typeof options?.fallbackPricelistId === 'number' && options.fallbackPricelistId > 0) {
    return options.fallbackPricelistId;
  }
  return getCompanyFallbackPricelistId(getEffectiveSalesCompanyId(options?.companyId));
}

const partnerPricelistResolutionCache = new Map<string, PartnerPricelistResolution>();
const pricelistItemsCache = new Map<number, PricelistItem[]>();
const pricelistCompanyCache = new Map<number, number | null>();

function buildPartnerResolutionCacheKey(partnerId: number, options?: PricingOptions): string {
  return `${partnerId}|${resolveFallbackPricelistId(options) ?? 0}`;
}

function extractPricelistId(value: unknown): number | null {
  return extractMany2oneId(value);
}

async function loadPricelistCompanyId(pricelistId: number): Promise<number | null> {
  if (pricelistCompanyCache.has(pricelistId)) {
    return pricelistCompanyCache.get(pricelistId) ?? null;
  }

  try {
    const rows = await odooRpc<Array<{ id: number; company_id?: [number, string] | number | false }>>(
      'product.pricelist',
      'read',
      [[pricelistId]],
      { fields: ['company_id'] },
    );
    const companyId = extractMany2oneId(rows?.[0]?.company_id);
    pricelistCompanyCache.set(pricelistId, companyId);
    return companyId;
  } catch (err) {
    console.warn(`[pricelist] read company_id failed for pricelist ${pricelistId}:`, err);
  }

  try {
    const rows = await odooRead<{ company_id?: [number, string] | number | false }>(
      'product.pricelist',
      [['id', '=', pricelistId]],
      ['company_id'],
      1,
    );
    const companyId = extractMany2oneId(rows?.[0]?.company_id);
    pricelistCompanyCache.set(pricelistId, companyId);
    return companyId;
  } catch (err) {
    console.warn(`[pricelist] /get_records company_id failed for pricelist ${pricelistId}:`, err);
  }

  pricelistCompanyCache.set(pricelistId, null);
  return null;
}

async function pickCompatiblePricelistId(
  partnerId: number,
  candidateId: number | null,
  effectiveCompanyId: number,
): Promise<number | null> {
  if (!candidateId) return null;

  const pricelistCompanyId = await loadPricelistCompanyId(candidateId);
  if (isPricelistCompatibleWithCompany(pricelistCompanyId, effectiveCompanyId)) {
    return candidateId;
  }

  console.warn(
    `[pricelist] Ignoring pricelist ${candidateId} for partner ${partnerId} because company mismatch. Expected ${effectiveCompanyId}, got ${pricelistCompanyId}`,
  );
  return null;
}

async function readPartnersForPricelist(partnerIds: number[]): Promise<Map<number, PartnerPricelistRecord>> {
  const uniqueIds = [...new Set(partnerIds.filter((id) => typeof id === 'number' && id > 0))];
  if (uniqueIds.length === 0) return new Map();

  const FIELDS = ['id', 'parent_id', 'commercial_partner_id', 'pricelist_id', 'property_product_pricelist'];

  // Strategy 1: Odoo web session (call_kw / execute_kw)
  try {
    const partners = await odooRpc<PartnerPricelistRecord[]>('res.partner', 'search_read', [
      [['id', 'in', uniqueIds]],
    ], { fields: FIELDS, limit: uniqueIds.length });
    if (partners && partners.length > 0) {
      return new Map(partners.map((p) => [p.id, p]));
    }
  } catch { /* session not available */ }

  // Strategy 2: /get_records via API key (no session needed)
  try {
    const partners = await odooRead<PartnerPricelistRecord>(
      'res.partner',
      [['id', 'in', uniqueIds]],
      FIELDS,
      uniqueIds.length,
    );
    if (partners && partners.length > 0) {
      return new Map(partners.map((p) => [p.id, p]));
    }
  } catch { /* /get_records also unavailable for res.partner */ }

  return new Map();
}

async function resolvePartnerPricelist(partnerId: number, options?: PricingOptions): Promise<PartnerPricelistResolution> {
  const resolutionCacheKey = buildPartnerResolutionCacheKey(partnerId, options);
  const cachedResolution = partnerPricelistResolutionCache.get(resolutionCacheKey);
  if (cachedResolution) {
    return cachedResolution;
  }

  const effectiveCompanyId = getEffectiveSalesCompanyId(options?.companyId);
  let candidatePartnerIds = [partnerId];

  try {
    const initialPartners = await readPartnersForPricelist([partnerId]);
    const initialPartner = initialPartners.get(partnerId);
    candidatePartnerIds = buildPartnerPricelistCandidates(initialPartner || { id: partnerId });

    if (candidatePartnerIds.length > 0) {
      pricelistDebug(`[pricelist] Candidate partners for ${partnerId}:`, JSON.stringify(candidatePartnerIds));
      const candidatePartnersMap = await readPartnersForPricelist(candidatePartnerIds);

      for (const candidateId of candidatePartnerIds) {
        const partner = candidatePartnersMap.get(candidateId);
        const rawPricelistId = getPreferredPartnerPricelistId(partner);
        const pricelistId = await pickCompatiblePricelistId(
          candidateId,
          rawPricelistId,
          effectiveCompanyId,
        );
        if (pricelistId) {
          pricelistDebug(`[pricelist] Partner ${candidateId} pricelist: ${pricelistId}`);
          const resolution: PartnerPricelistResolution = {
            candidatePartnerIds,
            resolvedPartnerId: candidateId,
            pricelistId,
            source: 'partner_field',
          };
          cacheResolvedPartnerPricelistId(partnerId, pricelistId, options);
          partnerPricelistResolutionCache.set(resolutionCacheKey, resolution);
          return resolution;
        }
      }
    }
  } catch (err) {
    console.warn('[pricelist] search_read failed:', err);
  }

  // ── Attempt 2: /get_records as last resort ──
  try {
    const partners = await odooRead<any>('res.partner', [
      ['id', '=', partnerId],
    ], ['pricelist_id', 'property_product_pricelist'], 1);

    pricelistDebug(`[pricelist] /get_records fallback for partner ${partnerId}:`, JSON.stringify(partners));

    if (partners && partners.length > 0) {
      const rawPricelistId = getPreferredPartnerPricelistId(partners[0]);
      const plId = await pickCompatiblePricelistId(partnerId, rawPricelistId, effectiveCompanyId);
      if (plId) {
        const resolution: PartnerPricelistResolution = {
          candidatePartnerIds,
          resolvedPartnerId: partnerId,
          pricelistId: plId,
          source: 'get_records',
        };
        cacheResolvedPartnerPricelistId(partnerId, plId, options);
        partnerPricelistResolutionCache.set(resolutionCacheKey, resolution);
        return resolution;
      }
    }
  } catch (err) {
    console.warn('[pricelist] /get_records fallback failed:', err);
  }

  const fallbackPricelistId = resolveFallbackPricelistId(options);
  if (fallbackPricelistId) {
    const resolution: PartnerPricelistResolution = {
      candidatePartnerIds,
      resolvedPartnerId: null,
      pricelistId: fallbackPricelistId,
      source: 'company_fallback',
    };
    // Cache null so peekResolvedPartnerPricelistId returns null — callers that
    // build the sale.order payload must NOT send the company fallback pricelist
    // because it may belong to a different company than the partner, causing
    // "Empresas incompatibles" errors in Odoo. The internal resolution cache
    // still holds the fallback so computeCustomerPrices can display prices.
    cacheResolvedPartnerPricelistId(partnerId, null, options);
    pricelistDebug(
      `[pricelist] Using company fallback pricelist ${fallbackPricelistId} for partner ${partnerId} (not sent to backend)`,
    );
    partnerPricelistResolutionCache.set(resolutionCacheKey, resolution);
    return resolution;
  }

  const resolution: PartnerPricelistResolution = {
    candidatePartnerIds,
    resolvedPartnerId: null,
    pricelistId: null,
    source: 'none',
  };
  cacheResolvedPartnerPricelistId(partnerId, null, options);
  partnerPricelistResolutionCache.set(resolutionCacheKey, resolution);
  return resolution;
}

/**
 * Load the partner's pricelist ID using direct JSON-RPC.
 *
 * /get_records does NOT return property fields like property_product_pricelist.
 * We use odooRpc → search_read which calls Odoo's native ORM and DOES
 * resolve property fields correctly.
 *
 * Returns null if no specific pricelist (= uses public).
 */
export async function getPartnerPricelistId(partnerId: number, options?: PricingOptions): Promise<number | null> {
  const resolution = await resolvePartnerPricelist(partnerId, options);
  if (!resolution.pricelistId) {
    pricelistDebug(`[pricelist] No pricelist found for partner ${partnerId}, using public prices`);
  }
  return resolution.pricelistId;
}

/**
 * Load pricelist items (rules) for a given pricelist.
 * Uses JSON-RPC search_read (primary) with /get_records fallback.
 */
async function loadPricelistItems(pricelistId: number): Promise<PricelistItem[]> {
  const cachedItems = pricelistItemsCache.get(pricelistId);
  if (cachedItems) return cachedItems;

  // Try direct JSON-RPC first
  try {
    const items = await odooRpc<PricelistItem[]>('product.pricelist.item', 'search_read', [
      [['pricelist_id', '=', pricelistId]],
    ], {
      fields: PRICELIST_ITEM_FIELDS,
      limit: 500,
    });

    if (items && items.length > 0) {
      pricelistDebug(`[pricelist] Loaded ${items.length} pricelist items via search_read for pricelist ${pricelistId}`);
      pricelistItemsCache.set(pricelistId, items);
      return items;
    }
  } catch (err) {
    console.warn('[pricelist] search_read pricelist items failed:', err);
  }

  // Fallback to /get_records
  try {
    const items = await odooRead<PricelistItem>('product.pricelist.item', [
      ['pricelist_id', '=', pricelistId],
    ], PRICELIST_ITEM_FIELDS, 500);
    pricelistDebug(`[pricelist] Loaded ${items?.length ?? 0} pricelist items via /get_records for pricelist ${pricelistId}`);
    pricelistItemsCache.set(pricelistId, items || []);
    return items || [];
  } catch (error) {
    console.warn('[pricelist] /get_records pricelist items failed:', error);
    return [];
  }
}

function sortPricelistItems(items: PricelistItem[]): PricelistItem[] {
  return [...items].sort((a, b) => {
    const orderMap: Record<string, number> = {
      '0_product_variant': 0,
      '1_product': 1,
      '2_product_category': 2,
      '3_global': 3,
    };
    return (orderMap[a.applied_on] ?? 4) - (orderMap[b.applied_on] ?? 4);
  });
}

function findMatchingRule(
  items: PricelistItem[],
  product: { id: number; list_price: number; product_tmpl_id?: any; categ_id?: any }
): PricelistItem | undefined {
  const tmplId = Array.isArray(product.product_tmpl_id)
    ? product.product_tmpl_id[0]
    : product.product_tmpl_id;
  const categId = Array.isArray(product.categ_id)
    ? product.categ_id[0]
    : product.categ_id;

  return items.find((item) => {
    if (item.min_quantity > 1) return false;

    switch (item.applied_on) {
      case '0_product_variant': {
        const itemProdId = extractMany2oneId(item.product_id);
        return itemProdId === product.id;
      }
      case '1_product': {
        const itemTmplId = extractMany2oneId(item.product_tmpl_id);
        return itemTmplId === tmplId;
      }
      case '2_product_category': {
        const itemCategId = extractMany2oneId(item.categ_id);
        return itemCategId === categId;
      }
      case '3_global':
        return true;
      default:
        return false;
    }
  });
}

/**
 * Fetch customer-specific prices from Odoo's custom endpoint.
 * This endpoint computes prices server-side using Odoo's native pricelist engine,
 * guaranteeing consistency with what Odoo itself would calculate.
 *
 * Returns Map<productId, customerPrice> or null if the endpoint is unavailable.
 */
async function fetchServerSidePrices(
  _partnerId: number,
  _products: Array<{ id: number; list_price: number }>,
): Promise<Map<number, number> | null> {
  // truck_stock returns warehouse-level catalog prices, not partner-specific
  // prices, so it can't replace a customer pricing endpoint. Falls through to
  // client-side pricelist computation, which correctly uses
  // property_product_pricelist fetched via search_read.
  return null;
}

/**
 * Compute customer-specific prices for a list of products.
 *
 * Strategy:
 *   1. Try server-side endpoint (Odoo computes prices natively — most accurate)
 *   2. Fall back to client-side pricelist item matching if endpoint unavailable
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
  // ── Strategy 1: Server-side (preferred — Odoo native pricelist engine) ──
  const serverPrices = await fetchServerSidePrices(partnerId, products);
  if (serverPrices !== null) {
    cacheCustomerPrices(partnerId, products, serverPrices, options);
    return serverPrices;
  }

  // ── Strategy 2: Client-side fallback ──
  const priceMap = new Map<number, number>();

  const resolution = await resolvePartnerPricelist(partnerId, options);
  const pricelistId = resolution.pricelistId;
  if (!pricelistId) {
    cacheCustomerPrices(partnerId, products, priceMap, options);
    return priceMap;
  }

  const items = await loadPricelistItems(pricelistId);
  if (items.length === 0) {
    pricelistDebug(`[pricelist] Pricelist ${pricelistId} has no items`);
    cacheCustomerPrices(partnerId, products, priceMap, options);
    return priceMap;
  }

  const itemsCache = new Map<number, PricelistItem[]>();
  itemsCache.set(pricelistId, sortPricelistItems(items));

  async function getSortedItemsForPricelist(targetPricelistId: number): Promise<PricelistItem[]> {
    const cached = itemsCache.get(targetPricelistId);
    if (cached) return cached;
    const loaded = sortPricelistItems(await loadPricelistItems(targetPricelistId));
    itemsCache.set(targetPricelistId, loaded);
    return loaded;
  }

  async function computePriceForProduct(
    targetPricelistId: number,
    product: { id: number; list_price: number; product_tmpl_id?: any; categ_id?: any; standard_price?: number },
    visited: Set<number>
  ): Promise<number> {
    if (visited.has(targetPricelistId)) return product.list_price;
    visited.add(targetPricelistId);

    const targetItems = await getSortedItemsForPricelist(targetPricelistId);
    const matchingRule = findMatchingRule(targetItems, product);
    if (!matchingRule) return product.list_price;

    if (matchingRule.compute_price === 'formula' && matchingRule.base === 'pricelist') {
      const nestedPricelistId = extractPricelistId(matchingRule.base_pricelist_id);
      if (nestedPricelistId && !visited.has(nestedPricelistId)) {
        const nestedPrice = await computePriceForProduct(nestedPricelistId, product, visited);
        return computeRulePrice(product, matchingRule, () => nestedPrice);
      }
    }

    return computeRulePrice(product, matchingRule);
  }

  for (const product of products) {
    const price = await computePriceForProduct(pricelistId, product, new Set());
    if (Math.abs(price - product.list_price) > 0.01) {
      priceMap.set(product.id, price);
    }
  }

  pricelistDebug(`[pricelist] Client-side: ${priceMap.size} custom prices for partner ${partnerId} (pricelist ${pricelistId})`);
  cacheCustomerPrices(partnerId, products, priceMap, options);
  return priceMap;
}

/**
 * Preload customer-specific prices for a route, with bounded concurrency.
 *
 * Why a concurrency cap: each partner triggers up to ~3-5 RPCs (search_read
 * partner → read pricelist company → search_read pricelist items, possibly
 * nested). Firing 20+ in parallel saturates the network and makes the
 * ProductPicker's own request queue behind them. A small cap keeps each
 * individual request fast and leaves headroom for foreground work.
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
