import type { InventoryFreshness } from './effectiveOfflineCatalog.ts';
import type { ProductStockPolicy } from './productStockPolicy.ts';

export interface SaleStockEnforcementInput {
  isOnline: boolean | null | undefined;
  policy: ProductStockPolicy;
  inventoryFreshness: InventoryFreshness;
}

export interface SaleStockEnforcementDecision {
  allowConfirm: boolean;
  shouldRefresh: boolean;
  enforceFreshStock: boolean;
}

const BLOCKED_WITHOUT_AUTHORITY: SaleStockEnforcementDecision = {
  allowConfirm: false,
  shouldRefresh: false,
  enforceFreshStock: false,
};

/**
 * Decides stock enforcement without conflating connectivity with inventory
 * authority. Only an explicit offline signal plus the visit-sale opt-in can
 * bypass stock. Unknown runtime connectivity always fails closed.
 */
export function decideSaleStockEnforcement(
  input: SaleStockEnforcementInput,
): SaleStockEnforcementDecision {
  if (!input || typeof input !== 'object') {
    return { ...BLOCKED_WITHOUT_AUTHORITY };
  }

  if (input.policy === 'strict') {
    return {
      allowConfirm: true,
      shouldRefresh: false,
      enforceFreshStock: true,
    };
  }

  if (input.policy !== 'offline_sale') {
    return {
      allowConfirm: false,
      shouldRefresh: false,
      enforceFreshStock: true,
    };
  }

  if (input.isOnline === false) {
    return {
      allowConfirm: true,
      shouldRefresh: false,
      enforceFreshStock: false,
    };
  }

  if (input.isOnline !== true) {
    return { ...BLOCKED_WITHOUT_AUTHORITY };
  }

  if (input.inventoryFreshness === 'authoritative') {
    return {
      allowConfirm: true,
      shouldRefresh: false,
      enforceFreshStock: true,
    };
  }

  return {
    allowConfirm: false,
    shouldRefresh: true,
    enforceFreshStock: false,
  };
}

export function shouldEnforceFreshSaleStock(
  input: SaleStockEnforcementInput,
): boolean {
  return decideSaleStockEnforcement(input).enforceFreshStock;
}
