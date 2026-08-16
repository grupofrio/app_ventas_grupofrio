/**
 * RN-free inventory ledger barrier (ports injected).
 */

import {
  appendMovements,
  createEmptyLedger,
  LEDGER_RECORD_KEY,
  migrateLegacySellableSnapshot,
  movementsForOperation,
  projectSellable,
} from '../domain/inventory/ledgerState.ts';
import type { InventoryMovement, LedgerState } from '../domain/inventory/types.ts';
import type { EncryptedSessionIdentity } from './encryptedStoreLogic.ts';
import { assertEncryptedRecord } from './encryptedStoreLogic.ts';

export { LEDGER_RECORD_KEY };

export interface InventoryLedgerPorts {
  getSession: () => Promise<EncryptedSessionIdentity | null>;
  load: (session: EncryptedSessionIdentity, key: string) => Promise<LedgerState | null>;
  save: (session: EncryptedSessionIdentity, key: string, value: LedgerState) => Promise<void>;
  applySellableProjection: (sellableByProductId: Record<number, number>) => void;
  readLegacySellable: () => Record<number, number>;
  nowIso: () => string;
}

export async function loadOrMigrateLedger(
  ports: InventoryLedgerPorts,
): Promise<{ session: EncryptedSessionIdentity; state: LedgerState }> {
  const session = await ports.getSession();
  if (!session) {
    throw new Error('Inventory ledger requires an encrypted field session');
  }
  const existing = await ports.load(session, LEDGER_RECORD_KEY);
  if (existing && existing.version === 1 && Array.isArray(existing.movements)) {
    return { session, state: existing };
  }
  const migrated = migrateLegacySellableSnapshot(
    ports.readLegacySellable(),
    `legacy-migrate:${ports.nowIso()}`,
    ports.nowIso(),
  );
  assertEncryptedRecord(LEDGER_RECORD_KEY, 'encrypted');
  await ports.save(session, LEDGER_RECORD_KEY, migrated);
  return { session, state: migrated };
}

/**
 * Atomic barrier: append movements → persist ledger → project sellable.
 * If persist fails, projection is not updated and the error propagates.
 */
export async function recordInventoryMovements(
  movements: InventoryMovement[],
  ports: InventoryLedgerPorts,
): Promise<LedgerState> {
  if (!Array.isArray(movements) || movements.length === 0) {
    throw new Error('recordInventoryMovements requires at least one movement');
  }
  const { session, state } = await loadOrMigrateLedger(ports);
  const next = appendMovements(state, movements);
  assertEncryptedRecord(LEDGER_RECORD_KEY, 'encrypted');
  await ports.save(session, LEDGER_RECORD_KEY, next);
  ports.applySellableProjection(projectSellable(next));
  return next;
}

export async function reverseInventoryOperation(
  operation_id: string,
  reversalMovements: InventoryMovement[],
  ports: InventoryLedgerPorts,
): Promise<LedgerState> {
  const { state } = await loadOrMigrateLedger(ports);
  const originals = movementsForOperation(state, operation_id);
  if (originals.length === 0) {
    return state;
  }
  return recordInventoryMovements(reversalMovements, ports);
}

export async function ensureLedgerHydrated(ports: InventoryLedgerPorts): Promise<LedgerState> {
  const { state } = await loadOrMigrateLedger(ports);
  ports.applySellableProjection(projectSellable(state));
  return state;
}

export function createMemoryLedgerPorts(seed?: LedgerState): InventoryLedgerPorts & {
  _state: LedgerState | null;
  _sellable: Record<number, number>;
} {
  const ports: InventoryLedgerPorts & {
    _state: LedgerState | null;
    _sellable: Record<number, number>;
  } = {
    _state: seed ?? null,
    _sellable: {},
    getSession: async () => ({ companyId: 1, employeeId: 1, sessionId: 'test-session' }),
    load: async () => ports._state,
    save: async (_s, _k, value) => {
      ports._state = value;
    },
    applySellableProjection: (map) => {
      ports._sellable = { ...map };
    },
    readLegacySellable: () => ({ ...ports._sellable }),
    nowIso: () => '2026-08-16T00:00:00.000Z',
  };
  if (!ports._state) {
    ports._state = createEmptyLedger('mem', ports.nowIso());
  }
  return ports;
}
