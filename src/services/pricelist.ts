/**
 * Customer pricing is evaluated exclusively by the employee API.
 *
 * The mobile client never resolves partner pricelists or price rules locally:
 * those are business rules owned and authorized by Odoo. Cached prices remain
 * display-only and are keyed by the same request inputs.
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
  cacheCustomerPrices,
  cacheResolvedPartnerPricelistId,
  getEffectiveSalesCompanyId,
  getCompanyFallbackPricelistId,
  isPricelistCompatibleWithCompany,
  peekResolvedPartnerPricelistId,
  peekCachedCustomerPrices,
  clearPricelistCaches as clearPartnerPricelistCaches,
} from './pricelistCache';

export {
  DEFAULT_SALES_COMPANY_ID,
  getEffectiveSalesCompanyId,
  peekCachedCustomerPrices,
  getCompanyFallbackPricelistId,
  isPricelistCompatibleWithCompany,
  peekResolvedPartnerPricelistId,
} from './pricelistCache';

const GF_BASE = 'gf/logistics/api/employee';

export interface PricingOptions {
  companyId?: number | null;
  /**
   * A stop-provided price list is sent as a constrained hint to the employee
   * endpoint. The server still decides whether it is valid for the session.
   */
  fallbackPricelistId?: number | null;
}

type PricingProduct = {
  id: number;
  list_price: number;
  product_tmpl_id?: unknown;
  categ_id?: unknown;
  standard_price?: number;
};

export class PricingUnavailableError extends Error {
  readonly code = 'pricing_unavailable';

  constructor(cause?: unknown) {
    super('No fue posible obtener los precios autorizados. Reconéctate e inténtalo de nuevo.');
    this.name = 'PricingUnavailableError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

const inFlightCustomerPrices = new Map<string, Promise<Map<number, number>>>();

/** Clears display caches after session changes or an explicit catalog refresh. */
export function clearPricelistCaches(): void {
  inFlightCustomerPrices.clear();
  clearPartnerPricelistCaches();
}

/**
 * Kept as a compatibility seam for sale construction. Pricelist ownership is
 * server-side now, so the client deliberately never discovers or supplies one.
 */
export async function getPartnerPricelistId(
  partnerId: number,
  options?: PricingOptions,
): Promise<number | null> {
  if (partnerId > 0) cacheResolvedPartnerPricelistId(partnerId, null, options);
  return null;
}

async function fetchServerSidePrices(
  partnerId: number,
  products: Array<Pick<PricingProduct, 'id' | 'list_price'>>,
  options?: PricingOptions,
): Promise<Map<number, number>> {
  if (!shouldTryServerPricingEndpoint()) {
    throw new PricingUnavailableError();
  }

  const productIds = products
    .map((product) => product.id)
    .filter((id) => typeof id === 'number' && Number.isFinite(id) && id > 0);
  if (partnerId <= 0 || productIds.length === 0) return new Map();

  const payload: Record<string, unknown> = { partner_id: partnerId, product_ids: productIds };
  if (typeof options?.fallbackPricelistId === 'number' && options.fallbackPricelistId > 0) {
    payload.pricelist_id = options.fallbackPricelistId;
  }

  try {
    const result = await postRest<any>(`${GF_BASE}/pricing/by_partner`, payload, {
      timeoutMs: DEFAULT_READ_TIMEOUT_MS,
    });
    if (!result || typeof result !== 'object' || result.ok !== true) {
      throw new PricingUnavailableError();
    }
    const data = result.data;
    if (!data || typeof data !== 'object' || !Array.isArray(data.prices)) {
      throw new PricingUnavailableError();
    }
    const rawPrices = data.prices;

    const productById = new Map(products.map((product) => [product.id, product]));
    const priceMap = new Map<number, number>();
    const addPrice = (productId: unknown, price: unknown): void => {
      if (typeof productId !== 'number' || !Number.isFinite(productId) || productId <= 0) return;
      if (typeof price !== 'number' || !Number.isFinite(price)) return;
      const product = productById.get(productId);
      if (product && Math.abs(price - product.list_price) > 0.01) priceMap.set(productId, price);
    };

    rawPrices.forEach((row: unknown) => {
      const priceRow = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      addPrice(priceRow.product_id, priceRow.price_unit);
    });
    markServerPricingEndpointAvailable();
    return priceMap;
  } catch (error) {
    disableServerPricingEndpointIfMissing(error);
    if (error instanceof PricingUnavailableError) throw error;
    throw new PricingUnavailableError(error);
  }
}

export function _peekInFlightCustomerPricesForTests(
  partnerId: number,
  products: Array<PricingProduct>,
  options?: PricingOptions,
): boolean {
  return inFlightCustomerPrices.has(buildPartnerCacheKey(partnerId, products, options));
}

export async function computeCustomerPrices(
  partnerId: number,
  products: Array<PricingProduct>,
  options?: PricingOptions,
): Promise<Map<number, number>> {
  const cachedPrices = peekCachedCustomerPrices(partnerId, products, options);
  if (cachedPrices) return cachedPrices;

  const inFlightKey = buildPartnerCacheKey(partnerId, products, options);
  const existing = inFlightCustomerPrices.get(inFlightKey);
  if (existing) return existing.then((prices) => new Map(prices));

  const request = fetchServerSidePrices(partnerId, products, options)
    .then((prices) => {
      cacheCustomerPrices(partnerId, products, prices, options);
      return prices;
    })
    .finally(() => inFlightCustomerPrices.delete(inFlightKey));
  inFlightCustomerPrices.set(inFlightKey, request);
  return request.then((prices) => new Map(prices));
}

/** Warm the display-only cache without suppressing the explicit API failure. */
export async function preloadRouteCustomerPrices(
  partnerIds: number[],
  products: Array<PricingProduct>,
  options?: PricingOptions,
): Promise<void> {
  const uniquePartnerIds = [...new Set(partnerIds.filter((id) => Number.isFinite(id) && id > 0))];
  await Promise.all(uniquePartnerIds.map(async (partnerId) => {
    if (!peekCachedCustomerPrices(partnerId, products, options)) {
      await computeCustomerPrices(partnerId, products, options);
    }
  }));
}
