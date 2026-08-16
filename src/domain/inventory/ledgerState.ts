/**
 * Pure ledger state transitions (RN-free).
 */

import { projectInventory, sellableMapFromProjection } from './projectInventory.ts';
import type { InventoryMovement, InventorySnapshot, LedgerState } from './types.ts';

export const LEDGER_RECORD_KEY = 'inventory-ledger';

export function createEmptyLedger(snapshot_version: string, snapshot_at: string): LedgerState {
  return {
    version: 1,
    snapshot_version,
    snapshot_at,
    snapshot: {},
    movements: [],
  };
}

/**
 * Migrate from legacy display stock: snapshot sellable = current displays, empty journal.
 * Does not invent history; prior optimistic deltas are folded into the baseline.
 */
export function migrateLegacySellableSnapshot(
  sellableByProductId: Record<number, number>,
  snapshot_version: string,
  snapshot_at: string,
): LedgerState {
  const snapshot: InventorySnapshot = {};
  for (const [rawId, qty] of Object.entries(sellableByProductId)) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) continue;
    snapshot[String(id)] = { sellable: qty };
  }
  return {
    version: 1,
    snapshot_version,
    snapshot_at,
    snapshot,
    movements: [],
  };
}

export function appendMovements(state: LedgerState, incoming: InventoryMovement[]): LedgerState {
  const existingIds = new Set(state.movements.map((m) => m.movement_id));
  const next = [...state.movements];
  for (const movement of incoming) {
    if (existingIds.has(movement.movement_id)) continue;
    existingIds.add(movement.movement_id);
    next.push(movement);
  }
  return { ...state, movements: next };
}

export function replaceServerSnapshot(
  state: LedgerState,
  snapshot: InventorySnapshot,
  snapshot_version: string,
  snapshot_at: string,
  /** Keep movements whose operation_id is still pending locally. */
  keepOperationIds: Set<string>,
): LedgerState {
  return {
    ...state,
    snapshot_version,
    snapshot_at,
    snapshot,
    movements: state.movements.filter((m) => keepOperationIds.has(m.operation_id)),
  };
}

export function projectSellable(state: LedgerState): Record<number, number> {
  return sellableMapFromProjection(
    projectInventory({ initialSnapshot: state.snapshot, movements: state.movements }),
  );
}

export function movementsForOperation(
  state: LedgerState,
  operation_id: string,
): InventoryMovement[] {
  return state.movements.filter((m) => m.operation_id === operation_id);
}
