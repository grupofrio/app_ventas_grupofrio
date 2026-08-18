/**
 * RN-free inventory ledger barrier (ports injected).
 *
 * Atomicity model (POST-R1A closure):
 * - All durable ledger writes go through EncryptedRecordMutator.updateRecords
 *   (single session-envelope RMW; no lost updates across concurrent appends).
 * - When a commercial op also needs a sync-queue row, queue + ledger are
 *   written in THE SAME envelope put via commitSyncQueueAndLedger.
 * - Projection / UI confirmation happens only after that put succeeds.
 */

import {
  appendMovements,
  createEmptyLedger,
  LEDGER_RECORD_KEY,
  migrateLegacySellableSnapshot,
  movementsForOperation,
  projectSellable,
  replaceServerSnapshot,
} from '../domain/inventory/ledgerState.ts';
import type { InventoryMovement, InventorySnapshot, LedgerState } from '../domain/inventory/types.ts';
import type {
  EncryptedRecordMutator,
  EncryptedSessionIdentity,
} from './encryptedStoreLogic.ts';
import { assertEncryptedRecord } from './encryptedStoreLogic.ts';

export { LEDGER_RECORD_KEY };

/** Sync queue record key inside the encrypted session envelope. */
export const SYNC_QUEUE_RECORD_KEY = 'sync:queue';

export interface InventoryLedgerPorts {
  getSession: () => Promise<EncryptedSessionIdentity | null>;
  /** Atomic read-modify-write of one or more encrypted session records. */
  updateRecords: (
    session: EncryptedSessionIdentity,
    mutator: (api: EncryptedRecordMutator) => void | Promise<void>,
  ) => Promise<void>;
  /** Read-only load (hydrate). Must not be used for append RMW. */
  load: (session: EncryptedSessionIdentity, key: string) => Promise<LedgerState | null>;
  applySellableProjection: (sellableByProductId: Record<number, number>) => void;
  readLegacySellable: () => Record<number, number>;
  nowIso: () => string;
  /** Publish durable queue to in-memory sync store after envelope commit. */
  publishQueue?: (queue: unknown[]) => void;
}

function isUsableLedger(value: unknown): value is LedgerState {
  return (
    !!value
    && typeof value === 'object'
    && (value as LedgerState).version === 1
    && Array.isArray((value as LedgerState).movements)
  );
}

function resolveLedgerState(
  existing: LedgerState | null,
  ports: InventoryLedgerPorts,
): LedgerState {
  if (isUsableLedger(existing)) return existing;
  // Migration runs once: only when no durable ledger exists yet.
  return migrateLegacySellableSnapshot(
    ports.readLegacySellable(),
    `legacy-migrate:${ports.nowIso()}`,
    ports.nowIso(),
  );
}

export async function loadOrMigrateLedger(
  ports: InventoryLedgerPorts,
): Promise<{ session: EncryptedSessionIdentity; state: LedgerState }> {
  const session = await ports.getSession();
  if (!session) {
    throw new Error('Inventory ledger requires an encrypted field session');
  }
  const existing = await ports.load(session, LEDGER_RECORD_KEY);
  if (isUsableLedger(existing)) {
    return { session, state: existing };
  }
  const migrated = resolveLedgerState(null, ports);
  assertEncryptedRecord(LEDGER_RECORD_KEY, 'encrypted');
  await ports.updateRecords(session, (api) => {
    // Race-safe: another writer may have created the ledger between load and now.
    const concurrent = api.getRecord<LedgerState>(LEDGER_RECORD_KEY);
    if (isUsableLedger(concurrent)) return;
    api.setRecord(LEDGER_RECORD_KEY, migrated);
  });
  const after = await ports.load(session, LEDGER_RECORD_KEY);
  return { session, state: isUsableLedger(after) ? after : migrated };
}

/**
 * Append movements via envelope RMW, then project sellable.
 * If the envelope write fails, projection is not updated.
 */
export async function recordInventoryMovements(
  movements: InventoryMovement[],
  ports: InventoryLedgerPorts,
): Promise<LedgerState> {
  if (!Array.isArray(movements) || movements.length === 0) {
    throw new Error('recordInventoryMovements requires at least one movement');
  }
  const session = await ports.getSession();
  if (!session) {
    throw new Error('Inventory ledger requires an encrypted field session');
  }

  let next: LedgerState | null = null;
  await ports.updateRecords(session, (api) => {
    const existing = api.getRecord<LedgerState>(LEDGER_RECORD_KEY);
    const state = resolveLedgerState(existing, ports);
    next = appendMovements(state, movements);
    assertEncryptedRecord(LEDGER_RECORD_KEY, 'encrypted');
    api.setRecord(LEDGER_RECORD_KEY, next);
  });
  if (!next) {
    throw new Error('recordInventoryMovements failed to produce ledger state');
  }
  ports.applySellableProjection(projectSellable(next));
  return next;
}

/**
 * Persist sync-queue + inventory-ledger in ONE envelope write.
 * On failure neither record changes. Caller must not confirm UI before this.
 */
export async function commitSyncQueueAndLedger(
  nextQueue: unknown[],
  movements: InventoryMovement[],
  ports: InventoryLedgerPorts,
): Promise<LedgerState> {
  if (!Array.isArray(movements) || movements.length === 0) {
    throw new Error('commitSyncQueueAndLedger requires at least one movement');
  }
  const session = await ports.getSession();
  if (!session) {
    throw new Error('Inventory ledger requires an encrypted field session');
  }

  let next: LedgerState | null = null;
  await ports.updateRecords(session, (api) => {
    assertEncryptedRecord(SYNC_QUEUE_RECORD_KEY, 'encrypted');
    assertEncryptedRecord(LEDGER_RECORD_KEY, 'encrypted');
    const existing = api.getRecord<LedgerState>(LEDGER_RECORD_KEY);
    const state = resolveLedgerState(existing, ports);
    next = appendMovements(state, movements);
    api.setRecord(SYNC_QUEUE_RECORD_KEY, nextQueue);
    api.setRecord(LEDGER_RECORD_KEY, next);
  });
  if (!next) {
    throw new Error('commitSyncQueueAndLedger failed to produce ledger state');
  }
  ports.publishQueue?.(nextQueue);
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

/**
 * INV-1: Rebase ledger against an authoritative server truck_stock snapshot.
 *
 * visible = server_snapshot + local movements still pending acknowledgement
 * (operation_ids in keepOperationIds). Movements for synced ops are dropped so
 * we do not double-apply effects the server already incorporated.
 *
 * No invented server revision: snapshot_version is a client label (timestamp /
 * hash of the refresh). Contract note: backend does not yet emit revision tokens.
 */
export async function rebaseLedgerFromServerSnapshot(
  ports: InventoryLedgerPorts,
  serverSellableByProductId: Record<number, number>,
  keepOperationIds: Set<string>,
  snapshotVersion: string,
): Promise<LedgerState> {
  const session = await ports.getSession();
  if (!session) {
    throw new Error('Inventory ledger requires an encrypted field session');
  }

  const snapshot: InventorySnapshot = {};
  for (const [rawId, qty] of Object.entries(serverSellableByProductId)) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || typeof qty !== 'number' || !Number.isFinite(qty)) continue;
    snapshot[String(id)] = { sellable: qty };
  }

  let next: LedgerState | null = null;
  await ports.updateRecords(session, (api) => {
    const existing = api.getRecord<LedgerState>(LEDGER_RECORD_KEY);
    const state = resolveLedgerState(existing, ports);
    next = replaceServerSnapshot(
      state,
      snapshot,
      snapshotVersion,
      ports.nowIso(),
      keepOperationIds,
    );
    assertEncryptedRecord(LEDGER_RECORD_KEY, 'encrypted');
    api.setRecord(LEDGER_RECORD_KEY, next);
  });
  if (!next) {
    throw new Error('rebaseLedgerFromServerSnapshot failed to produce ledger state');
  }
  ports.applySellableProjection(projectSellable(next));
  return next;
}

/** Sync queue item shapes that have already mutated the local ledger. */
export const LEDGER_AFFECTING_SYNC_TYPES = new Set([
  'sale_order',
  'gift',
  'consignment_create',
  'consignment_visit',
  'consignment_close',
]);

/**
 * @deprecated Prefer keepLedgerOperationIdsForSnapshot (INV-1B ack-aware keep-set).
 * Kept for transitional imports; delegates to status≠done/dead only.
 */
export function pendingLedgerOperationIdsFromQueue(
  queue: Array<{ id: string; type: string; status: string; payload?: Record<string, unknown> }>,
): Set<string> {
  const keep = new Set<string>();
  for (const item of queue) {
    if (!LEDGER_AFFECTING_SYNC_TYPES.has(item.type)) continue;
    if (item.status === 'done' || item.status === 'dead') continue;
    keep.add(item.id);
    const payloadOp = item.payload?.operation_id ?? item.payload?._operationId;
    if (typeof payloadOp === 'string' && payloadOp.trim()) keep.add(payloadOp.trim());
  }
  return keep;
}

export function createMemoryLedgerPorts(seed?: LedgerState | null): InventoryLedgerPorts & {
  _state: LedgerState | null;
  _queue: unknown[];
  _sellable: Record<number, number>;
  _failNextWrite: boolean;
  _writeDelayMs: number;
} {
  let chain: Promise<void> = Promise.resolve();

  const ports: InventoryLedgerPorts & {
    _state: LedgerState | null;
    _queue: unknown[];
    _sellable: Record<number, number>;
    _failNextWrite: boolean;
    _writeDelayMs: number;
  } = {
    // undefined → empty ledger for unit tests; null → force migration path
    _state: seed === undefined ? createEmptyLedger('mem', '2026-08-16T00:00:00.000Z') : seed,
    _queue: [],
    _sellable: {},
    _failNextWrite: false,
    _writeDelayMs: 0,
    getSession: async () => ({ companyId: 1, employeeId: 1, sessionId: 'test-session' }),
    load: async () => ports._state,
    updateRecords: async (_session, mutator) => {
      const run = chain.then(async () => {
        if (ports._writeDelayMs > 0) {
          await new Promise((r) => setTimeout(r, ports._writeDelayMs));
        }
        const draftLedger = ports._state
          ? JSON.parse(JSON.stringify(ports._state)) as LedgerState
          : null;
        const draftQueue = JSON.parse(JSON.stringify(ports._queue)) as unknown[];
        const bag: Record<string, unknown> = {};
        if (draftLedger) bag[LEDGER_RECORD_KEY] = draftLedger;
        bag[SYNC_QUEUE_RECORD_KEY] = draftQueue;

        await mutator({
          getRecord<T>(key: string): T | null {
            if (!(key in bag)) return null;
            return bag[key] as T;
          },
          setRecord<T>(key: string, value: T): void {
            bag[key] = value;
          },
          removeRecord(key: string): void {
            delete bag[key];
          },
        });

        if (ports._failNextWrite) {
          ports._failNextWrite = false;
          throw new Error('disk full');
        }
        ports._state = (bag[LEDGER_RECORD_KEY] as LedgerState | undefined) ?? null;
        ports._queue = (bag[SYNC_QUEUE_RECORD_KEY] as unknown[]) ?? [];
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      await run;
    },
    applySellableProjection: (map) => {
      ports._sellable = { ...map };
    },
    readLegacySellable: () => ({ ...ports._sellable }),
    nowIso: () => '2026-08-16T00:00:00.000Z',
    publishQueue: (queue) => {
      ports._queue = queue;
    },
  };
  return ports;
}
