/**
 * Production inventory ledger — binds RN encrypted store + product projection.
 */

import type { InventoryMovement, LedgerState } from '../domain/inventory/types.ts';
import {
  commitQueueItemAndLedger as commitQueueItemAndLedgerWithPorts,
  commitSyncQueueAndLedger as commitSyncQueueAndLedgerWithPorts,
  ensureLedgerHydrated as ensureLedgerHydratedWithPorts,
  LEDGER_RECORD_KEY,
  loadOrMigrateLedger as loadOrMigrateLedgerWithPorts,
  pendingLedgerOperationIdsFromQueue,
  rebaseLedgerFromServerSnapshot as rebaseLedgerFromServerSnapshotWithPorts,
  recordInventoryMovements as recordInventoryMovementsWithPorts,
  reverseInventoryOperation as reverseInventoryOperationWithPorts,
  type InventoryLedgerPorts,
  type LedgerQueueItem,
} from './inventoryLedgerLogic.ts';
import { assertEncryptedRecord } from './encryptedStoreLogic.ts';
import {
  keepLedgerOperationIdsForSnapshot,
  type AmbiguousQueueItem,
} from './ambiguousAckReconcile.ts';

export {
  LEDGER_RECORD_KEY,
  SYNC_QUEUE_RECORD_KEY,
  createMemoryLedgerPorts,
  pendingLedgerOperationIdsFromQueue,
  LEDGER_AFFECTING_SYNC_TYPES,
} from './inventoryLedgerLogic.ts';
export type { InventoryLedgerPorts, LedgerQueueItem } from './inventoryLedgerLogic.ts';
export {
  keepLedgerOperationIdsForSnapshot,
  SERVER_ACK_AT_MS_KEY,
} from './ambiguousAckReconcile.ts';

async function productionPorts(): Promise<InventoryLedgerPorts> {
  const [
    { loadEncrypted, updateEncryptedRecords },
    { getFieldDataSession },
    { useProductStore },
    { useSyncStore },
  ] = await Promise.all([
    import('./encryptedStore.ts'),
    import('./fieldDataSession.ts'),
    import('../stores/useProductStore.ts'),
    import('../stores/useSyncStore.ts'),
  ]);
  return {
    getSession: getFieldDataSession,
    load: async (session, key) => {
      assertEncryptedRecord(key, 'encrypted');
      return loadEncrypted<LedgerState>(session, key);
    },
    updateRecords: async (session, mutator) => {
      await updateEncryptedRecords(session, mutator);
    },
    applySellableProjection: (sellableByProductId) => {
      useProductStore.getState().applySellableProjection(sellableByProductId);
    },
    readLegacySellable: () => {
      const products = useProductStore.getState().products;
      const out: Record<number, number> = {};
      for (const product of products) {
        out[product.id] = product.qty_display;
      }
      return out;
    },
    nowIso: () => new Date().toISOString(),
    publishQueue: (queue) => {
      useSyncStore.getState().replaceQueueFromDurable(queue as never);
    },
    publishQueueItem: (item) => {
      useSyncStore.getState().publishLedgerBackedQueueItem(item as never);
    },
  };
}

async function resolvePorts(ports?: InventoryLedgerPorts): Promise<InventoryLedgerPorts> {
  return ports ?? productionPorts();
}

export async function loadOrMigrateLedger(ports?: InventoryLedgerPorts) {
  return loadOrMigrateLedgerWithPorts(await resolvePorts(ports));
}

export async function recordInventoryMovements(
  movements: InventoryMovement[],
  ports?: InventoryLedgerPorts,
): Promise<LedgerState> {
  return recordInventoryMovementsWithPorts(movements, await resolvePorts(ports));
}

export async function commitSyncQueueAndLedger(
  nextQueue: unknown[],
  movements: InventoryMovement[],
  ports?: InventoryLedgerPorts,
): Promise<LedgerState> {
  return commitSyncQueueAndLedgerWithPorts(nextQueue, movements, await resolvePorts(ports));
}

export async function commitQueueItemAndLedger(args: {
  item: LedgerQueueItem;
  movements: InventoryMovement[];
  ports?: InventoryLedgerPorts;
}): Promise<LedgerState> {
  return commitQueueItemAndLedgerWithPorts({
    item: args.item,
    movements: args.movements,
    ports: await resolvePorts(args.ports),
  });
}

export async function reverseInventoryOperation(
  operation_id: string,
  reversalMovements: InventoryMovement[],
  ports?: InventoryLedgerPorts,
): Promise<LedgerState> {
  return reverseInventoryOperationWithPorts(
    operation_id,
    reversalMovements,
    await resolvePorts(ports),
  );
}

export async function ensureLedgerHydrated(ports?: InventoryLedgerPorts): Promise<LedgerState> {
  return ensureLedgerHydratedWithPorts(await resolvePorts(ports));
}

export async function rebaseLedgerFromServerSnapshot(
  serverSellableByProductId: Record<number, number>,
  keepOperationIds: Set<string>,
  snapshotVersion: string,
  ports?: InventoryLedgerPorts,
): Promise<LedgerState> {
  return rebaseLedgerFromServerSnapshotWithPorts(
    await resolvePorts(ports),
    serverSellableByProductId,
    keepOperationIds,
    snapshotVersion,
  );
}

/**
 * After truck_stock refresh: rebase ledger snapshot and re-project sellable.
 * Keep-set is ACK-aware (INV-1B): drop only when snapshotAtMs >= server ack.
 */
export async function rebaseAfterTruckStockRefresh(
  products: Array<{ id: number; qty_available: number }>,
  snapshotAtMs: number = Date.now(),
  ports?: InventoryLedgerPorts,
): Promise<LedgerState | null> {
  try {
    const [{ useSyncStore }] = await Promise.all([
      import('../stores/useSyncStore.ts'),
    ]);
    const queue = useSyncStore.getState().queue as AmbiguousQueueItem[];
    const keep = keepLedgerOperationIdsForSnapshot(queue, snapshotAtMs);
    const sellable: Record<number, number> = {};
    for (const p of products) {
      if (typeof p.qty_available === 'number' && Number.isFinite(p.qty_available)) {
        sellable[p.id] = p.qty_available;
      }
    }
    const version = `truck_stock:${new Date(snapshotAtMs).toISOString()}`;
    return rebaseLedgerFromServerSnapshot(sellable, keep, version, ports);
  } catch (err) {
    throw err;
  }
}
