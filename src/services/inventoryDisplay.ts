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

export function getInventoryProductListState(input: {
  hasStockData: boolean | null;
  visibleProductCount: number;
}): {
  kind: 'unknown' | 'empty' | 'products';
  title?: string;
  detail?: string;
} {
  if (input.hasStockData !== true) {
    return {
      kind: 'unknown',
      title: 'Sin dato',
      detail: 'Aún no hay inventario confirmado de tu unidad.',
    };
  }
  return input.visibleProductCount === 0 ? { kind: 'empty' } : { kind: 'products' };
}
