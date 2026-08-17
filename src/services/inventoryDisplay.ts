/**
 * Inventory screen display helpers — RN-free.
 * Unknown / non-authoritative stock must never look like measured 0.
 */

export const INVENTORY_SIN_DATO = 'Sin dato';

/**
 * Total kg for summary / home KPI.
 * Only `hasStockData === true` may render a numeric kilogram figure.
 */
export function formatAuthoritativeStockKg(input: {
  hasStockData: boolean | null;
  totalStockKg: number;
}): string {
  if (input.hasStockData !== true) return INVENTORY_SIN_DATO;
  if (!Number.isFinite(input.totalStockKg)) return INVENTORY_SIN_DATO;
  return `${input.totalStockKg} kg`;
}

/** Forecast placeholder until KoldDemand — never `--`. */
export function formatForecastKg(forecastKg: number): string {
  if (!Number.isFinite(forecastKg) || forecastKg <= 0) return INVENTORY_SIN_DATO;
  return `${forecastKg} kg`;
}

/**
 * When stock is not authoritative, keep catalog rows visible so the list
 * does not collapse to empty (false "sin productos").
 * When authoritative, hide zero-sellable rows as before.
 */
export function shouldListProductOnInventory(input: {
  hasStockData: boolean | null;
  qtyAvailable: number;
}): boolean {
  if (input.hasStockData !== true) return true;
  return Number.isFinite(input.qtyAvailable) && input.qtyAvailable > 0;
}

export function formatInventoryProductQty(input: {
  hasStockData: boolean | null;
  qtyDisplay: number;
  totalKg: number;
  qtyReserved?: number;
}): string {
  if (input.hasStockData !== true) return INVENTORY_SIN_DATO;
  const qty = Number.isFinite(input.qtyDisplay) ? input.qtyDisplay : null;
  const kg = Number.isFinite(input.totalKg) ? input.totalKg : null;
  if (qty == null || kg == null) return INVENTORY_SIN_DATO;
  const reserved =
    typeof input.qtyReserved === 'number' &&
    Number.isFinite(input.qtyReserved) &&
    input.qtyReserved > 0
      ? ` · ${input.qtyReserved} res.`
      : '';
  return `${qty} disp. · ${kg.toFixed(0)}kg${reserved}`;
}
