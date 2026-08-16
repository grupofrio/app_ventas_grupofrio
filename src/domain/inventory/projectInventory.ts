/**
 * Pure inventory projection from snapshot + append-only movements.
 *
 * Exact arithmetic — never silently clamp negatives to 0.
 * Local sellable is referential; oversell → explicit deficit.
 */

import {
  EMPTY_BALANCES,
  withDerivedFields,
  type InventoryBucket,
  type InventoryMovement,
  type InventorySnapshot,
  type ProductBucketBalances,
} from './types.ts';

function cloneBalances(partial?: Partial<ProductBucketBalances>): ProductBucketBalances {
  const base = EMPTY_BALANCES();
  if (!partial) return base;
  for (const key of ['sellable', 'consigned', 'return_good', 'damaged', 'pending'] as const) {
    const value = partial[key];
    // Snapshot baselines must be finite non-negative. Projection math may go negative later.
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      base[key] = value;
    }
  }
  return withDerivedFields(base);
}

function applySide(
  balances: ProductBucketBalances,
  bucket: InventoryBucket | null,
  signedQty: number,
): void {
  if (!bucket) return;
  // Exact math — no Math.max(0, …). Oversell produces negative sellable / deficit.
  balances[bucket] = balances[bucket] + signedQty;
}

function compareMovements(a: InventoryMovement, b: InventoryMovement): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  if (a.movement_id < b.movement_id) return -1;
  if (a.movement_id > b.movement_id) return 1;
  return 0;
}

export interface ProjectInventoryInput {
  initialSnapshot: InventorySnapshot;
  movements: InventoryMovement[];
}

export type InventoryProjection = Record<string, ProductBucketBalances>;

/**
 * Project bucket balances. Duplicate `movement_id` rows are ignored (idempotent).
 * Quantities must be finite and > 0; invalid rows are skipped (fail-closed per row).
 */
export function projectInventory({
  initialSnapshot,
  movements,
}: ProjectInventoryInput): InventoryProjection {
  const result: InventoryProjection = {};
  for (const [productKey, partial] of Object.entries(initialSnapshot || {})) {
    result[productKey] = cloneBalances(partial);
  }

  const seen = new Set<string>();
  const ordered = [...(movements || [])].sort(compareMovements);
  for (const movement of ordered) {
    if (!movement || typeof movement.movement_id !== 'string') continue;
    if (seen.has(movement.movement_id)) continue;
    seen.add(movement.movement_id);

    if (
      typeof movement.product_id !== 'number' ||
      !Number.isFinite(movement.product_id) ||
      typeof movement.quantity !== 'number' ||
      !Number.isFinite(movement.quantity) ||
      movement.quantity <= 0
    ) {
      continue;
    }

    const key = String(movement.product_id);
    if (!result[key]) result[key] = EMPTY_BALANCES();
    const balances = result[key];

    applySide(balances, movement.bucket_from, -movement.quantity);
    applySide(balances, movement.bucket_to, +movement.quantity);
    withDerivedFields(balances);
  }

  return result;
}

export function sellableMapFromProjection(
  projection: InventoryProjection,
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [key, balances] of Object.entries(projection)) {
    const id = Number(key);
    if (!Number.isFinite(id)) continue;
    out[id] = balances.sellable;
  }
  return out;
}
