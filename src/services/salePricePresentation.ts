import type { SalePriceConfirmation } from './salePriceConfirmation.ts';

export interface SalePriceConfirmationLine {
  priceConfirmation?: SalePriceConfirmation;
}

export interface SalePricePresentation {
  amount: number | null;
  label: string | null;
}

export const PENDING_PRICE_CONFIRMATION_LABEL = 'Pendiente de confirmar por Odoo';

export function hasPendingSalePriceConfirmation(
  lines: readonly SalePriceConfirmationLine[],
): boolean {
  return lines.some((line) => line.priceConfirmation === 'pending_confirmation');
}

export function getSalePricePresentation(
  amount: number,
  priceConfirmationPending: boolean,
): SalePricePresentation {
  return priceConfirmationPending
    ? { amount: null, label: PENDING_PRICE_CONFIRMATION_LABEL }
    : { amount, label: null };
}
