import type { CapturedCustomerPrice } from './customerPricingSnapshot';

export interface ProductPriceSelectionInput {
  readonly isOnline: boolean;
  readonly snapshotPrice: CapturedCustomerPrice | null;
  readonly publicPrice: number;
}

export interface ProductPriceSelection {
  readonly price: CapturedCustomerPrice;
  readonly requiresPublicFallbackConfirmation: boolean;
}

function assertValidPrice(unitPrice: number, label: string): void {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new RangeError(`invalid ${label} product price`);
  }
}

export function selectProductPrice(
  input: ProductPriceSelectionInput,
): ProductPriceSelection {
  let price: CapturedCustomerPrice;

  if (input.snapshotPrice) {
    assertValidPrice(input.snapshotPrice.unitPrice, 'selected');
    price = { ...input.snapshotPrice };
  } else {
    assertValidPrice(input.publicPrice, 'public');
    price = {
      unitPrice: input.publicPrice,
      source: 'public_fallback',
      capturedAtMs: null,
      pricelistId: null,
    };
  }

  return {
    price,
    requiresPublicFallbackConfirmation:
      !input.isOnline && price.source === 'public_fallback',
  };
}
