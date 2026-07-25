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

export interface ProductPricingCaptureIdentity {
  readonly capturedAtMs: number;
  readonly captureRunId: string;
}

export interface ProductPricingRequestToken {
  readonly generation: number;
  readonly contextKey: string;
  readonly capture: ProductPricingCaptureIdentity;
}

export interface LatestProductPricingRequestGate {
  begin(
    contextKey: string,
    capture: ProductPricingCaptureIdentity,
  ): ProductPricingRequestToken;
  isCurrent(token: ProductPricingRequestToken): boolean;
  cancel(token: ProductPricingRequestToken): boolean;
  invalidate(): void;
}

export function createLatestProductPricingRequestGate(): LatestProductPricingRequestGate {
  let generation = 0;
  let current: ProductPricingRequestToken | null = null;

  return {
    begin(contextKey, capture) {
      generation += 1;
      current = Object.freeze({
        generation,
        contextKey,
        capture: Object.freeze({ ...capture }),
      });
      return current;
    },
    isCurrent(token) {
      return current === token;
    },
    cancel(token) {
      if (current !== token) return false;
      generation += 1;
      current = null;
      return true;
    },
    invalidate() {
      generation += 1;
      current = null;
    },
  };
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
