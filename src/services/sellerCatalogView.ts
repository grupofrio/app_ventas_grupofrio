/**
 * Default seller catalog when the phone is offline.
 *
 * truck_stock (and its same-day cache) can include every saleable product,
 * shared ones included, with quantity 0. ProductPicker orders that list by
 * "has quantity" and then by name. When every line is 0, the name sort puts
 * shared `[BARRA-*]` products first. That is the list Álvaro saw offline.
 * It is not another plaza's pricelist.
 *
 * Offline, the unsearched list prefers the last snapshot that actually had
 * quantity on this unit. Zero-quantity lines stay searchable. A phone that
 * has never stored a positive snapshot does not present that full list as
 * the default view. Online, the server list is shown as returned.
 */

/** Last positive van snapshot survives the next calendar day, not a whole week. */
export const VAN_ASSORTMENT_TTL_MS = 48 * 60 * 60 * 1000;

export interface SellerCatalogLine {
  id: number;
  name: string;
  qty_display: number;
  qty_available?: number;
  qty_reserved?: number;
  _totalKg?: number;
  isRecommended?: boolean;
  default_code?: string | null;
}

export type SellerCatalogMode = 'current' | 'van_snapshot' | 'search' | 'empty';

export interface SellerCatalogView<T> {
  mode: SellerCatalogMode;
  lines: T[];
}

export function buildVanAssortmentContextKey(input: {
  employeeId: number | null;
  companyId: number | null;
  warehouseId: number | null;
}): string | null {
  const { employeeId, companyId, warehouseId } = input;
  if (
    typeof employeeId !== 'number' || employeeId <= 0
    || typeof companyId !== 'number' || companyId <= 0
    || typeof warehouseId !== 'number' || warehouseId <= 0
  ) {
    return null;
  }
  // Company 34 holds both Guadalajara and Iguala. The unit warehouse keeps
  // those snapshots apart. The calendar day is intentionally absent: the
  // same-day catalog cache drops yesterday's van stock on the next morning.
  // Same separator as buildContextKey (`|`).
  return [employeeId, companyId, warehouseId].join('|');
}

export function positiveVanLines<T extends { qty_available?: number }>(products: T[]): T[] {
  return products.filter((product) =>
    typeof product.qty_available === 'number' && product.qty_available > 0);
}

/**
 * A later truck_stock with no positive quantity must not erase the last
 * assortment that did. A new positive load replaces it.
 */
export function retainPositiveAssortment<T extends { qty_available?: number }>(
  previous: T[] | null,
  incoming: T[],
): T[] | null {
  const positive = positiveVanLines(incoming);
  if (positive.length > 0) return positive;
  return previous && previous.length > 0 ? previous : null;
}

function lineStock(line: { qty_available?: number; qty_display: number }): number {
  return typeof line.qty_available === 'number' ? line.qty_available : line.qty_display;
}

function compareCatalogLines<T extends SellerCatalogLine>(a: T, b: T): number {
  if (a.isRecommended && !b.isRecommended) return -1;
  if (!a.isRecommended && b.isRecommended) return 1;
  if (a.qty_display > 0 && b.qty_display <= 0) return -1;
  if (a.qty_display <= 0 && b.qty_display > 0) return 1;
  return a.name.localeCompare(b.name);
}

function fuzzyMatch(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  const words = query.toLowerCase().trim().split(/\s+/);
  return words.every((word) => haystack.includes(word));
}

function restoreSnapshotQty<T extends SellerCatalogLine>(current: T, snapshot: T): T {
  return {
    ...current,
    qty_display: snapshot.qty_display,
    qty_available: snapshot.qty_available,
    qty_reserved: snapshot.qty_reserved,
    _totalKg: snapshot._totalKg,
  };
}

export function selectSellerCatalogView<T extends SellerCatalogLine>(input: {
  products: T[];
  positiveAssortment: T[] | null;
  isOnline: boolean;
  query: string;
}): SellerCatalogView<T> {
  const query = input.query.trim();
  if (query) {
    const snapshotById = new Map((input.positiveAssortment ?? []).map((line) => [line.id, line]));
    const seen = new Set<number>();
    const lines: T[] = [];
    for (const line of input.products) {
      seen.add(line.id);
      const snapshot = snapshotById.get(line.id);
      // Offline, a zero in the current payload must not hide the last
      // positive quantity of a unit line. A product that was never on the
      // van stays at zero and remains findable.
      const restored = !input.isOnline
        && line.qty_display <= 0
        && snapshot
        && lineStock(snapshot) > 0
        ? restoreSnapshotQty(line, snapshot)
        : line;
      lines.push(restored);
    }
    if (!input.isOnline) {
      for (const line of input.positiveAssortment ?? []) {
        if (!seen.has(line.id)) lines.push(line);
      }
    }
    return {
      mode: 'search',
      lines: lines
        .filter((line) => fuzzyMatch(`${line.name} ${line.default_code ?? ''}`, query))
        .sort(compareCatalogLines),
    };
  }

  if (input.products.some((line) => line.qty_display > 0)) {
    return { mode: 'current', lines: [...input.products].sort(compareCatalogLines) };
  }

  const snapshot = (input.positiveAssortment ?? []).filter((line) => lineStock(line) > 0);
  if (!input.isOnline && snapshot.length > 0) {
    const currentById = new Map(input.products.map((line) => [line.id, line]));
    const lines = snapshot
      .map((line) => {
        const current = currentById.get(line.id);
        return current ? restoreSnapshotQty(current, line) : line;
      })
      .sort(compareCatalogLines);
    return { mode: 'van_snapshot', lines };
  }

  if (!input.isOnline) {
    return { mode: 'empty', lines: [] };
  }

  return { mode: 'current', lines: [...input.products].sort(compareCatalogLines) };
}

export function describeMissingVanAssortment(hasReferentialCatalog: boolean): string {
  if (hasReferentialCatalog) {
    return 'Sin existencias de tu unidad en la última carga. Busca por nombre para ver el resto del catálogo referencial.';
  }
  return 'Sin inventario de tu unidad en este teléfono. Conéctate para sincronizar la camioneta.';
}
