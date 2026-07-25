/**
 * Minimal product metadata retained after a product is used in a local sale.
 *
 * This deliberately does not contain customer-specific prices or inventory.
 * Both belong to their own snapshots.
 */
export interface RecentProductSnapshot {
  productId: number;
  name: string;
  defaultCode: string | null;
  listPrice: number;
  weight: number;
  lastSeenAtMs: number;
}

export const MAX_RECENT_PRODUCTS_PER_CONTEXT = 100;

interface ParsedRecentProduct {
  productId: number;
  name: string | undefined;
  defaultCode: string | null | undefined;
  listPrice: number | undefined;
  weight: number | undefined;
  lastSeenAtMs: number;
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

function safeTimestamp(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? value
    : null;
}

function safeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? value
    : undefined;
}

function safeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function safeDefaultCode(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseRecentProduct(value: unknown): ParsedRecentProduct | null {
  const record = asRecord(value);
  if (!record) return null;

  const productId = positiveProductId(record.productId);
  const lastSeenAtMs = safeTimestamp(record.lastSeenAtMs);
  if (productId === null || lastSeenAtMs === null) return null;

  return {
    productId,
    name: safeNonEmptyString(record.name),
    defaultCode: safeDefaultCode(record.defaultCode),
    listPrice: safeNonNegativeNumber(record.listPrice),
    weight: safeNonNegativeNumber(record.weight),
    lastSeenAtMs,
  };
}

function compareOptionalStrings(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const safeLeft = left ?? '';
  const safeRight = right ?? '';
  return safeLeft < safeRight ? -1 : safeLeft > safeRight ? 1 : 0;
}

function compareParsedRecentProducts(
  left: ParsedRecentProduct,
  right: ParsedRecentProduct,
): number {
  return left.productId - right.productId
    || left.lastSeenAtMs - right.lastSeenAtMs
    || compareOptionalStrings(left.name, right.name)
    || compareOptionalStrings(left.defaultCode, right.defaultCode)
    || (left.listPrice ?? -1) - (right.listPrice ?? -1)
    || (left.weight ?? -1) - (right.weight ?? -1);
}

function parseContainer(values: unknown): ParsedRecentProduct[] {
  if (!Array.isArray(values)) return [];
  return values
    .map(parseRecentProduct)
    .filter((value): value is ParsedRecentProduct => value !== null)
    .sort(compareParsedRecentProducts);
}

function mergeSnapshot(
  current: RecentProductSnapshot | undefined,
  candidate: ParsedRecentProduct,
): RecentProductSnapshot {
  return {
    productId: candidate.productId,
    name: candidate.name ?? current?.name ?? `Producto ${candidate.productId}`,
    defaultCode: candidate.defaultCode !== undefined
      ? candidate.defaultCode
      : current?.defaultCode ?? null,
    listPrice: candidate.listPrice ?? current?.listPrice ?? 0,
    weight: candidate.weight ?? current?.weight ?? 0,
    lastSeenAtMs: Math.max(current?.lastSeenAtMs ?? 0, candidate.lastSeenAtMs),
  };
}

function newestFirst(
  left: RecentProductSnapshot,
  right: RecentProductSnapshot,
): number {
  return right.lastSeenAtMs - left.lastSeenAtMs
    || left.productId - right.productId;
}

/**
 * Upserts one exact-context recent-product index.
 *
 * Context partitioning is intentionally owned by the caller/repository: this
 * function receives and returns only one context's entries, so it cannot
 * accidentally copy products between companies, employees or warehouses.
 */
export function upsertRecentProducts(
  existing: readonly unknown[] | null | undefined,
  incoming: readonly unknown[] | null | undefined,
): RecentProductSnapshot[] {
  const byProductId = new Map<number, RecentProductSnapshot>();

  for (const parsed of parseContainer(existing)) {
    byProductId.set(
      parsed.productId,
      mergeSnapshot(byProductId.get(parsed.productId), parsed),
    );
  }

  for (const parsed of parseContainer(incoming)) {
    byProductId.set(
      parsed.productId,
      mergeSnapshot(byProductId.get(parsed.productId), parsed),
    );
  }

  const oldestFirst = [...byProductId.values()].sort((left, right) =>
    left.lastSeenAtMs - right.lastSeenAtMs
      || left.productId - right.productId
  );
  const excess = Math.max(
    0,
    oldestFirst.length - MAX_RECENT_PRODUCTS_PER_CONTEXT,
  );

  return oldestFirst
    .slice(excess)
    .sort(newestFirst)
    .map((product) => ({ ...product }));
}
