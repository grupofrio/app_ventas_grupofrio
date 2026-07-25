import type { RecentProductSnapshot } from './recentProductIndex';

export type InventoryFreshness = 'authoritative' | 'cached' | 'unknown';
export type EffectiveProductOrigin = 'current' | 'last_known' | 'recent';

export interface EffectiveOfflineProduct {
  productId: number;
  name: string;
  defaultCode: string | null;
  listPrice: number;
  weight: number;
  qtyDisplay: number | null;
  origin: EffectiveProductOrigin;
  inventoryFreshness: InventoryFreshness;
  inventoryCapturedAtMs: number | null;
}

export interface BuildEffectiveOfflineCatalogInput {
  currentProducts?: readonly unknown[] | null;
  /**
   * Omitting freshness is intentionally conservative. A product already in
   * memory is not authoritative unless the caller verified that its online
   * load applies to the current warehouse/context.
   */
  currentInventoryFreshness?: InventoryFreshness;
  currentInventoryCapturedAtMs?: number | null;
  lastKnownProducts?: readonly unknown[] | null;
  lastKnownInventoryCapturedAtMs?: number | null;
  recentProducts?: readonly RecentProductSnapshot[] | readonly unknown[] | null;
}

interface NormalizedCatalogProduct {
  productId: number;
  name: string;
  defaultCode: string | null;
  listPrice: number;
  weight: number;
  qtyDisplay: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveProductId(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value > 0
    ? value
    : null;
}

function safeNonNegativeNumber(value: unknown): number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? value
    : 0;
}

function safeQuantity(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? value
    : null;
}

function safeName(value: unknown, productId: number): string {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.length > 0) return normalized;
  }
  return `Producto ${productId}`;
}

function safeDefaultCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function safeCapturedAtMs(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? value
    : null;
}

function normalizeCatalogProduct(
  value: unknown,
  idField: 'id' | 'productId',
): NormalizedCatalogProduct | null {
  const record = asRecord(value);
  if (!record) return null;

  const productId = positiveProductId(record[idField]);
  if (productId === null) return null;

  const usesOdooFields = idField === 'id';
  return {
    productId,
    name: safeName(record.name, productId),
    defaultCode: safeDefaultCode(
      usesOdooFields ? record.default_code : record.defaultCode,
    ),
    listPrice: safeNonNegativeNumber(
      usesOdooFields ? record.list_price : record.listPrice,
    ),
    weight: safeNonNegativeNumber(record.weight),
    qtyDisplay: usesOdooFields
      ? safeQuantity(record.qty_display)
      : null,
  };
}

function compareNormalizedProducts(
  left: NormalizedCatalogProduct,
  right: NormalizedCatalogProduct,
): number {
  const compareText = (leftValue: string, rightValue: string): number =>
    leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;

  return left.productId - right.productId
    || compareText(left.name, right.name)
    || compareText(left.defaultCode ?? '', right.defaultCode ?? '')
    || left.listPrice - right.listPrice
    || left.weight - right.weight
    || (left.qtyDisplay ?? -1) - (right.qtyDisplay ?? -1);
}

function normalizeSource(
  values: readonly unknown[] | null | undefined,
  idField: 'id' | 'productId',
): NormalizedCatalogProduct[] {
  if (!Array.isArray(values)) return [];

  const normalized = values
    .map((value) => normalizeCatalogProduct(value, idField))
    .filter((value): value is NormalizedCatalogProduct => value !== null)
    .sort(compareNormalizedProducts);

  const unique: NormalizedCatalogProduct[] = [];
  let previousProductId: number | null = null;
  for (const product of normalized) {
    if (product.productId === previousProductId) continue;
    unique.push(product);
    previousProductId = product.productId;
  }
  return unique;
}

function safeCurrentFreshness(value: unknown): InventoryFreshness {
  return value === 'authoritative' || value === 'unknown'
    ? value
    : 'cached';
}

/**
 * Builds the offline presentation catalog with source precedence:
 * current memory > exact-context last-known snapshot > recent local products.
 *
 * Output order is stable and independent of source input order: source
 * precedence first, then ascending productId within each source.
 */
export function buildEffectiveOfflineCatalog(
  input: BuildEffectiveOfflineCatalogInput,
): EffectiveOfflineProduct[] {
  const result: EffectiveOfflineProduct[] = [];
  const seen = new Set<number>();

  const append = (
    products: readonly NormalizedCatalogProduct[],
    origin: EffectiveProductOrigin,
    inventoryFreshness: InventoryFreshness,
    inventoryCapturedAtMs: number | null,
  ): void => {
    for (const product of products) {
      if (seen.has(product.productId)) continue;
      seen.add(product.productId);
      result.push({
        ...product,
        qtyDisplay: origin === 'recent' ? null : product.qtyDisplay,
        origin,
        inventoryFreshness,
        inventoryCapturedAtMs,
      });
    }
  };

  append(
    normalizeSource(input.currentProducts, 'id'),
    'current',
    safeCurrentFreshness(input.currentInventoryFreshness),
    safeCapturedAtMs(input.currentInventoryCapturedAtMs),
  );
  append(
    normalizeSource(input.lastKnownProducts, 'id'),
    'last_known',
    'cached',
    safeCapturedAtMs(input.lastKnownInventoryCapturedAtMs),
  );
  append(
    normalizeSource(input.recentProducts, 'productId'),
    'recent',
    'unknown',
    null,
  );

  return result;
}
