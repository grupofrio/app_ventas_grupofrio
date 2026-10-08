/**
 * Catálogo de producto nuevo (entrega) en un cambio.
 *
 * Con inventario fresco de la van (`truck_stock`, el mismo que usa la venta)
 * solo se ofrecen líneas con existencia y la cantidad no puede pasarla.
 * Sin conexión, con caché de jornada o sin `has_stock_data`, se deja el
 * catálogo completo y se avisa: el servidor sigue siendo quien rechaza.
 * La merma no pasa por este filtro.
 */

export const EXCHANGE_REPLACEMENT_STOCK_WARNING =
  'No se pudo confirmar el stock de la van (sin conexión o inventario en caché). Se muestra el catálogo completo; si el producto no tiene existencia, el servidor rechazará el cambio.';

export interface ExchangeReplacementStockInput {
  isOnline: boolean;
  fromCache: boolean;
  hasStockData: boolean | null;
  inventoryContext: 'ready' | 'plan_unavailable';
  lastSync: number | null;
}

export interface ReplacementStockProduct {
  id: number;
  name?: string;
  qty_display?: number;
  qty_available?: number;
}

export interface ExchangeReplacementCatalog<T> {
  mode: 'van_stock' | 'full_catalog';
  products: T[];
  warning: string | null;
}

export interface ReplacementQtyLine {
  productId: number;
  qty: number;
  productName?: string;
}

export interface ReplacementQtyOverage {
  productId: number;
  productName: string;
  requested: number;
  available: number;
  message: string;
}

export function isExchangeVanStockTrusted(input: ExchangeReplacementStockInput): boolean {
  if (!input.isOnline) return false;
  if (input.fromCache) return false;
  if (input.inventoryContext !== 'ready') return false;
  if (input.hasStockData !== true) return false;
  if (input.lastSync == null) return false;
  return true;
}

export function availableReplacementQty(
  product: { qty_display?: number; qty_available?: number } | null | undefined,
): number | null {
  if (!product) return null;
  if (typeof product.qty_display === 'number' && Number.isFinite(product.qty_display)) {
    return product.qty_display;
  }
  if (typeof product.qty_available === 'number' && Number.isFinite(product.qty_available)) {
    return product.qty_available;
  }
  return null;
}

export function formatStockQty(qty: number): string {
  const rounded = Math.round(qty * 1000) / 1000;
  return String(rounded);
}

function parsePositiveQty(value: string): number | null {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) return null;
  const qty = Number(normalized);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return qty;
}

export function selectExchangeReplacementCatalog<T extends ReplacementStockProduct>(
  products: readonly T[],
  input: ExchangeReplacementStockInput,
): ExchangeReplacementCatalog<T> {
  if (!isExchangeVanStockTrusted(input)) {
    return {
      mode: 'full_catalog',
      products: [...products],
      warning: EXCHANGE_REPLACEMENT_STOCK_WARNING,
    };
  }
  return {
    mode: 'van_stock',
    products: products.filter((product) => (availableReplacementQty(product) ?? 0) > 0),
    warning: null,
  };
}

export function initialReplacementQtyText(available: number | null): string {
  if (available == null || available >= 1) return '1';
  if (available <= 0) return '';
  return formatStockQty(available);
}

export function clampReplacementQtyText(qtyText: string, available: number | null): string {
  if (available == null) return qtyText;
  const qty = parsePositiveQty(qtyText);
  if (qty == null || qty <= available) return qtyText;
  if (available <= 0) return '';
  return formatStockQty(available);
}

export function findReplacementQtyOverages(
  lines: readonly ReplacementQtyLine[],
  products: readonly ReplacementStockProduct[],
): ReplacementQtyOverage[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const issues: ReplacementQtyOverage[] = [];
  for (const line of lines) {
    const product = byId.get(line.productId);
    const available = availableReplacementQty(product);
    const name = line.productName || product?.name || `Producto #${line.productId}`;
    if (available != null && line.qty <= available) continue;
    const shown = available != null && available > 0 ? available : 0;
    issues.push({
      productId: line.productId,
      productName: name,
      requested: line.qty,
      available: shown,
      message: shown <= 0
        ? `${name} está agotado en la van.`
        : `${name}: pediste ${formatStockQty(line.qty)}, disponible ${formatStockQty(shown)} en la van.`,
    });
  }
  return issues;
}
