import {
  storeLoad,
  storeLoadStrict,
  storeSave,
  storeSaveStrict,
} from '../persistence/storage.ts';
import {
  getSaleTicketStorageKey,
  normalizeOdooFolio,
  parseSaleTicketSnapshot,
  shouldReplaceTicketSnapshot,
} from './saleTicket.ts';
import type {
  SaleTicketOrigin,
  SaleTicketSnapshot,
} from './saleTicket.ts';
import { normalizeSellerName } from './saleTicketFormatting.ts';

type StoredSaleTicketSnapshot =
  Omit<SaleTicketSnapshot, 'odooFolio' | 'sellerName'>
  & {
    odooFolio?: unknown;
    sellerName?: unknown;
  };

export interface SaleTicketStorageAdapter {
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, value: T): Promise<void>;
}

export interface SaleTicketSnapshotStorage {
  load(key: string): Promise<unknown>;
  save?(key: string, snapshot: SaleTicketSnapshot): Promise<void>;
  saveStrict(key: string, snapshot: SaleTicketSnapshot): Promise<void>;
}

function normalizeOperationId(operationId: string): string | null {
  const normalized = operationId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeStoredSaleTicketSnapshot(
  snapshot: StoredSaleTicketSnapshot,
): SaleTicketSnapshot {
  const saleId = typeof snapshot.saleId === 'string' ? snapshot.saleId.trim() : '';
  const parsed = parseSaleTicketSnapshot({
    ...snapshot,
    saleId,
    odooFolio: normalizeOdooFolio(snapshot.odooFolio),
    sellerName: normalizeSellerName(
      typeof snapshot.sellerName === 'string' ? snapshot.sellerName : undefined,
    ),
  }, saleId);
  if (!parsed) {
    throw new TypeError('Invalid stored sale ticket snapshot');
  }
  return parsed;
}

export function mergeStoredSaleTicketSnapshot(
  current: StoredSaleTicketSnapshot | null,
  incoming: StoredSaleTicketSnapshot,
): SaleTicketSnapshot {
  const normalizedIncoming = normalizeStoredSaleTicketSnapshot(incoming);
  if (current === null) return normalizedIncoming;

  const normalizedCurrent = normalizeStoredSaleTicketSnapshot(current);
  const incomingOrigin = normalizedIncoming.origin ?? 'local';
  if (!shouldReplaceTicketSnapshot({
    existingOrigin: normalizedCurrent.origin,
    incomingOrigin,
  })) {
    return normalizedCurrent;
  }
  return {
    ...normalizedIncoming,
    odooFolio: normalizedIncoming.odooFolio ?? normalizedCurrent.odooFolio,
  };
}

const defaultStrictStorageAdapter: SaleTicketStorageAdapter = {
  load: <T>(key: string) => storeLoadStrict<T>(key),
  save: <T>(key: string, value: T) => storeSaveStrict(key, value),
};

const criticalSaleTicketTails = new Map<string, Promise<void>>();

async function serializeCriticalSaleTicketOperation<T>(
  saleId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previousTail = criticalSaleTicketTails.get(saleId) ?? Promise.resolve();
  const result = previousTail.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  criticalSaleTicketTails.set(saleId, tail);

  try {
    return await result;
  } finally {
    if (criticalSaleTicketTails.get(saleId) === tail) {
      criticalSaleTicketTails.delete(saleId);
    }
  }
}

async function saveStoredSaleTicketSnapshot(
  snapshot: SaleTicketSnapshot,
  storage: SaleTicketStorageAdapter,
  forcedOrigin?: SaleTicketOrigin,
): Promise<void> {
  const operationId = normalizeOperationId(snapshot.saleId);
  if (!operationId) {
    throw new TypeError('Sale ticket operation id must not be blank');
  }
  await serializeCriticalSaleTicketOperation(operationId, async () => {
    const key = getSaleTicketStorageKey(operationId);
    const current = await storage.load<StoredSaleTicketSnapshot>(key);
    const incoming: StoredSaleTicketSnapshot = {
      ...snapshot,
      saleId: operationId,
      ...(forcedOrigin === undefined ? {} : { origin: forcedOrigin }),
    };
    const merged = mergeStoredSaleTicketSnapshot(current, incoming);
    await storage.save(key, merged);
  });
}

export async function saveSaleTicketSnapshot(
  snapshot: SaleTicketSnapshot,
  storage: SaleTicketStorageAdapter = defaultStrictStorageAdapter,
): Promise<void> {
  await saveStoredSaleTicketSnapshot(snapshot, storage);
}

export async function saveAuthoritativeSaleTicketSnapshot(
  snapshot: SaleTicketSnapshot,
  storage: SaleTicketStorageAdapter = defaultStrictStorageAdapter,
): Promise<void> {
  await saveStoredSaleTicketSnapshot(snapshot, storage, 'odoo');
}

export async function promoteStoredSaleTicketOdooFolio(
  saleId: string,
  odooFolio: string,
  storage: SaleTicketStorageAdapter = defaultStrictStorageAdapter,
): Promise<'updated' | 'missing'> {
  const operationId = normalizeOperationId(saleId);
  if (!operationId) {
    throw new TypeError('Sale ticket operation id must not be blank');
  }
  return serializeCriticalSaleTicketOperation(operationId, async () => {
    const key = getSaleTicketStorageKey(operationId);
    const current = await storage.load<StoredSaleTicketSnapshot>(key);
    if (current === null) return 'missing';

    const normalizedCurrent = normalizeStoredSaleTicketSnapshot(current);
    const promoted = mergeStoredSaleTicketSnapshot(current, {
      ...normalizedCurrent,
      odooFolio: normalizeOdooFolio(odooFolio),
    });
    await storage.save(key, promoted);
    return 'updated';
  });
}

export class SaleTicketSnapshotRepository {
  private readonly storage: SaleTicketSnapshotStorage;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(storage: SaleTicketSnapshotStorage) {
    this.storage = storage;
  }

  async load(operationId: string): Promise<SaleTicketSnapshot | null> {
    const normalizedOperationId = normalizeOperationId(operationId);
    if (!normalizedOperationId) return null;
    const stored = await this.storage.load(
      getSaleTicketStorageKey(normalizedOperationId),
    );
    return parseSaleTicketSnapshot(stored, normalizedOperationId);
  }

  saveLocal(snapshot: SaleTicketSnapshot): Promise<boolean> {
    return this.save(snapshot, 'local', false);
  }

  saveAuthoritative(snapshot: SaleTicketSnapshot): Promise<boolean> {
    return this.save(snapshot, 'odoo', true);
  }

  private save(
    snapshot: SaleTicketSnapshot,
    incomingOrigin: SaleTicketOrigin,
    requireStrictWrite: boolean,
  ): Promise<boolean> {
    return this.serialize(async () => {
      const normalizedOperationId = normalizeOperationId(snapshot.saleId);
      if (!normalizedOperationId) {
        throw new TypeError('Sale ticket operation id must not be blank');
      }
      const key = getSaleTicketStorageKey(normalizedOperationId);
      let existing: unknown;
      try {
        existing = await this.storage.load(key);
      } catch (error) {
        if (requireStrictWrite) throw error;
        return false;
      }
      const existingSnapshot = existing === null
        ? null
        : parseSaleTicketSnapshot(existing, normalizedOperationId);
      if (existing !== null && !existingSnapshot && !requireStrictWrite) {
        return false;
      }
      if (
        existingSnapshot
        && !shouldReplaceTicketSnapshot({
          existingOrigin: existingSnapshot.origin,
          incomingOrigin,
        })
      ) {
        return false;
      }

      const incoming = parseSaleTicketSnapshot({
        ...snapshot,
        saleId: normalizedOperationId,
        origin: incomingOrigin,
      }, normalizedOperationId);
      if (!incoming) {
        if (requireStrictWrite) {
          throw new TypeError('Invalid authoritative sale ticket snapshot');
        }
        return false;
      }
      const merged = existingSnapshot
        ? mergeStoredSaleTicketSnapshot(existingSnapshot, incoming)
        : incoming;
      if (requireStrictWrite || !this.storage.save) {
        await this.storage.saveStrict(key, merged);
      } else {
        await this.storage.save(key, merged);
      }
      return true;
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function createSaleTicketSnapshotRepository(
  storage: SaleTicketSnapshotStorage,
): SaleTicketSnapshotRepository {
  return new SaleTicketSnapshotRepository(storage);
}

// Keep the injected repository's production storage policy explicit: policy
// reads are strict, local writes can still opt into the tolerant adapter.
export const applicationSaleTicketSnapshotStorage: SaleTicketSnapshotStorage = {
  load: (key) => storeLoadStrict<unknown>(key),
  save: (key, snapshot) => storeSave(key, snapshot),
  saveStrict: (key, snapshot) => storeSaveStrict(key, snapshot),
};

export async function loadSaleTicketSnapshot(
  saleId: string,
): Promise<SaleTicketSnapshot | null> {
  const normalizedOperationId = normalizeOperationId(saleId);
  if (!normalizedOperationId) return null;
  const stored = await storeLoad<unknown>(
    getSaleTicketStorageKey(normalizedOperationId),
  );
  if (stored === null) return null;
  try {
    return normalizeStoredSaleTicketSnapshot(stored as StoredSaleTicketSnapshot);
  } catch {
    return null;
  }
}

export async function loadSaleTicketSnapshotStrict(
  saleId: string,
): Promise<SaleTicketSnapshot | null> {
  const normalizedOperationId = normalizeOperationId(saleId);
  if (!normalizedOperationId) return null;
  const stored = await storeLoadStrict<StoredSaleTicketSnapshot>(
    getSaleTicketStorageKey(normalizedOperationId),
  );
  if (stored === null) return null;
  return normalizeStoredSaleTicketSnapshot(stored);
}

type SaleTicketSnapshotLoader = (
  saleId: string,
) => Promise<SaleTicketSnapshot | null>;

export async function loadSaleTicketSnapshots(
  saleIds: string[],
  loadSnapshot: SaleTicketSnapshotLoader = loadSaleTicketSnapshot,
): Promise<Map<string, SaleTicketSnapshot>> {
  const seen = new Set<string>();
  const uniqueIds: Array<{ original: string; normalized: string }> = [];

  for (const original of saleIds) {
    const normalized = normalizeOperationId(original);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueIds.push({ original, normalized });
  }

  const settled = await Promise.allSettled(
    uniqueIds.map(({ normalized }) => (
      Promise.resolve().then(() => loadSnapshot(normalized))
    )),
  );
  const snapshots = new Map<string, SaleTicketSnapshot>();

  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled' || result.value === null) return;
    snapshots.set(uniqueIds[index].original, result.value);
  });

  return snapshots;
}
