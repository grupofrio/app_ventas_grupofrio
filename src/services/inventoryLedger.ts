/**
 * Production inventory ledger — binds RN encrypted store + product projection.
 */

import type { InventoryMovement, LedgerState } from '../domain/inventory/types.ts';
import {
  ensureLedgerHydrated as ensureLedgerHydratedWithPorts,
  LEDGER_RECORD_KEY,
  loadOrMigrateLedger as loadOrMigrateLedgerWithPorts,
  recordInventoryMovements as recordInventoryMovementsWithPorts,
  reverseInventoryOperation as reverseInventoryOperationWithPorts,
  type InventoryLedgerPorts,
} from './inventoryLedgerLogic.ts';
import { assertEncryptedRecord } from './encryptedStoreLogic.ts';

export { LEDGER_RECORD_KEY, createMemoryLedgerPorts } from './inventoryLedgerLogic.ts';
export type { InventoryLedgerPorts } from './inventoryLedgerLogic.ts';

async function productionPorts(): Promise<InventoryLedgerPorts> {
  const [{ loadEncrypted, saveEncrypted }, { getFieldDataSession }, { useProductStore }] =
    await Promise.all([
      import('./encryptedStore.ts'),
      import('./fieldDataSession.ts'),
      import('../stores/useProductStore.ts'),
    ]);
  return {
    getSession: getFieldDataSession,
    load: async (session, key) => {
      assertEncryptedRecord(key, 'encrypted');
      return loadEncrypted<LedgerState>(session, key);
    },
    save: async (session, key, value) => {
      assertEncryptedRecord(key, 'encrypted');
      await saveEncrypted(session, key, value);
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
