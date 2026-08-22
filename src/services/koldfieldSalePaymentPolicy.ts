export type KoldFieldSalePaymentMethod = 'cash' | 'credit';

export interface KoldFieldSalePaymentPresentation {
  method: KoldFieldSalePaymentMethod;
  label: string;
  reviewRequired: boolean;
}

export interface DayBundleSalePaymentInput {
  stopId: number;
  customerId: number;
  stops: unknown[];
  directory: unknown[];
}

function recordWithId(entries: unknown[], id: number): Record<string, unknown> | null {
  const match = entries.find((entry) => (
    typeof entry === 'object'
    && entry !== null
    && !Array.isArray(entry)
    && (entry as Record<string, unknown>).id === id
  ));
  return match && typeof match === 'object' && !Array.isArray(match)
    ? match as Record<string, unknown>
    : null;
}

/**
 * Presentation-only mapping for a validated day-bundle customer policy.
 * The Bearer sales endpoint recalculates and persists the authoritative
 * payment method when the operation reaches the server.
 */
export function presentKoldFieldSalePaymentPolicy(
  policy: unknown,
): KoldFieldSalePaymentPresentation {
  const mode = policy && typeof policy === 'object' && !Array.isArray(policy)
    ? (policy as Record<string, unknown>).mode
    : null;

  if (mode === 'cash_only') {
    return { method: 'cash', label: 'Contado', reviewRequired: false };
  }
  if (mode === 'credit_allowed') {
    return { method: 'credit', label: 'Crédito', reviewRequired: false };
  }
  if (mode === 'blocked') {
    return { method: 'credit', label: 'Crédito · revisar', reviewRequired: true };
  }
  return { method: 'cash', label: 'Contado · revisar', reviewRequired: true };
}

/**
 * Route stops take precedence. Off-route visits can only use the directory
 * record already included in the validated bundle; this remains UI context,
 * never a payment instruction sent to the server.
 */
export function salePaymentPresentationFromDayBundle(
  input: DayBundleSalePaymentInput,
): KoldFieldSalePaymentPresentation {
  const stop = recordWithId(input.stops, input.stopId);
  const directory = recordWithId(input.directory, input.customerId);
  return presentKoldFieldSalePaymentPolicy(stop?.payment_policy ?? directory?.payment_policy);
}
