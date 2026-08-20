export type SalePriceConfirmation = 'authorized' | 'pending_confirmation';

export interface ResolvedSaleLinePrice {
  price: number;
  priceConfirmation: SalePriceConfirmation;
}

/**
 * Decides whether a direct sale line has an authoritative local price or must
 * remain explicitly pending for Odoo confirmation after sync.
 */
export function resolveSaleLinePrice(input: {
  customerPrice: number | null;
  allowPendingPrice: boolean;
}): ResolvedSaleLinePrice | null {
  if (typeof input.customerPrice === 'number' && Number.isFinite(input.customerPrice) && input.customerPrice >= 0) {
    return { price: input.customerPrice, priceConfirmation: 'authorized' };
  }
  if (!input.allowPendingPrice) return null;
  return { price: 0, priceConfirmation: 'pending_confirmation' };
}
