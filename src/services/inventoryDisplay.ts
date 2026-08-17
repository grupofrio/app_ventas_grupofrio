/**
 * Inventory copy must distinguish a confirmed zero from the absence of a
 * truck-stock snapshot. This is display-only; it never changes stock state.
 */
export function formatInventoryKg(input: {
  hasStockData: boolean | null;
  quantityKg: number;
}): string {
  if (input.hasStockData !== true) return 'Sin dato';
  return `${input.quantityKg} kg`;
}
