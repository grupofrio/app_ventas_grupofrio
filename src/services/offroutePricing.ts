import type { OffrouteSearchResult } from './offrouteSearchLogic';

type PricingProduct = {
  id: number;
  list_price: number;
  product_tmpl_id?: unknown;
  categ_id?: unknown;
  standard_price?: number;
};

type PricingOptions = {
  companyId?: number | null;
  fallbackPricelistId?: number | null;
};

type WarmupContext = {
  companyId?: number | null;
  warehouseId?: number | null;
};

type WarmupDeps = {
  getProducts: () => PricingProduct[];
  loadProducts: (warehouseId: number) => Promise<void>;
  computeCustomerPrices: (
    partnerId: number,
    products: PricingProduct[],
    options?: PricingOptions,
  ) => Promise<Map<number, number>>;
};

type WarmupResult =
  | { status: 'warmed' }
  | { status: 'skipped'; reason: 'missing_partner' | 'missing_products' | 'missing_warehouse' }
  | { status: 'failed'; reason: string };

function resolveResultPartnerId(
  result: Pick<OffrouteSearchResult, 'id' | 'entityType' | 'partnerId'>,
): number | null {
  if (typeof result.partnerId === 'number' && result.partnerId > 0) {
    return result.partnerId;
  }
  if (result.entityType === 'customer' && typeof result.id === 'number' && result.id > 0) {
    return result.id;
  }
  return null;
}

export async function warmOffrouteCustomerPrices(
  result: Pick<OffrouteSearchResult, 'id' | 'entityType' | 'partnerId' | 'pricelistId'>,
  context: WarmupContext,
  deps: WarmupDeps,
): Promise<WarmupResult> {
  const partnerId = resolveResultPartnerId(result);
  if (!partnerId) {
    return { status: 'skipped', reason: 'missing_partner' };
  }

  let products = deps.getProducts();
  if (products.length === 0) {
    if (typeof context.warehouseId !== 'number' || context.warehouseId <= 0) {
      return { status: 'skipped', reason: 'missing_warehouse' };
    }

    try {
      await deps.loadProducts(context.warehouseId);
      products = deps.getProducts();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'product_load_failed';
      return { status: 'failed', reason };
    }
  }

  if (products.length === 0) {
    return { status: 'skipped', reason: 'missing_products' };
  }

  try {
    await deps.computeCustomerPrices(partnerId, products, {
      companyId: context.companyId,
      fallbackPricelistId: result.pricelistId,
    });
    return { status: 'warmed' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'price_warmup_failed';
    return { status: 'failed', reason };
  }
}
