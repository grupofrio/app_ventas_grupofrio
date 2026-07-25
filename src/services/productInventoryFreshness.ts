import type { InventorySource } from '../stores/useProductStore.ts';
import type { InventoryFreshness } from './effectiveOfflineCatalog.ts';

export interface InventoryAuthorityInput {
  isOnline: boolean;
  loadedWarehouseId: number | null;
  expectedWarehouseId: number | null;
  inventorySource: InventorySource | null;
  fromCache: boolean;
}

function positiveSafeId(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0;
}

/**
 * Describes how much authority the UI may assign to the current quantities.
 * Connectivity alone is never enough to promote a cached or fallback result.
 */
export function describeInventoryAuthority(
  input: InventoryAuthorityInput,
): InventoryFreshness {
  if (!input || typeof input !== 'object') return 'unknown';
  if (input.fromCache === true) return 'cached';
  if (input.fromCache !== false || input.isOnline !== true) return 'unknown';
  if (
    !positiveSafeId(input.loadedWarehouseId)
    || !positiveSafeId(input.expectedWarehouseId)
    || input.loadedWarehouseId !== input.expectedWarehouseId
  ) {
    return 'unknown';
  }
  return input.inventorySource === 'truck_stock'
    ? 'authoritative'
    : 'unknown';
}
