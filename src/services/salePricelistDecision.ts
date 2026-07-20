export interface SalePricelistDecisionInput {
  isOnline: boolean;
  stopPricelistId: number | null;
  cachedPricelistId: number | null;
}

export interface SalePricelistDecision {
  pricelistId: number | null;
  shouldResolvePartnerPricelist: boolean;
}

function asPositivePricelistId(value: number | null): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

export function decideSalePricelist(
  input: SalePricelistDecisionInput,
): SalePricelistDecision {
  const stopPricelistId = asPositivePricelistId(input.stopPricelistId);
  if (stopPricelistId !== null) {
    return {
      pricelistId: stopPricelistId,
      shouldResolvePartnerPricelist: false,
    };
  }

  return {
    pricelistId: asPositivePricelistId(input.cachedPricelistId),
    shouldResolvePartnerPricelist: input.isOnline,
  };
}
