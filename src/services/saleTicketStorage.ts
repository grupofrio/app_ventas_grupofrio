import {
  storeLoad,
  storeLoadStrict,
  storeSave,
  storeSaveStrict,
} from '../persistence/storage.ts';
import {
  getSaleTicketStorageKey,
  parseSaleTicketSnapshot,
  shouldReplaceTicketSnapshot,
} from './saleTicket.ts';
import type {
  SaleTicketOrigin,
  SaleTicketSnapshot,
} from './saleTicket.ts';

export interface SaleTicketSnapshotStorage {
  load(key: string): Promise<unknown>;
  save?(key: string, snapshot: SaleTicketSnapshot): Promise<void>;
  saveStrict(key: string, snapshot: SaleTicketSnapshot): Promise<void>;
}

function normalizeOperationId(operationId: string): string | null {
  const normalized = operationId.trim();
  return normalized.length > 0 ? normalized : null;
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
      if (requireStrictWrite || !this.storage.save) {
        await this.storage.saveStrict(key, incoming);
      } else {
        await this.storage.save(key, incoming);
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

const applicationRepository = createSaleTicketSnapshotRepository({
  load: (key) => storeLoadStrict<unknown>(key),
  save: (key, snapshot) => storeSave(key, snapshot),
  saveStrict: (key, snapshot) => storeSaveStrict(key, snapshot),
});

export async function saveSaleTicketSnapshot(snapshot: SaleTicketSnapshot): Promise<void> {
  await applicationRepository.saveLocal(snapshot);
}

export async function saveAuthoritativeSaleTicketSnapshot(
  snapshot: SaleTicketSnapshot,
): Promise<void> {
  await applicationRepository.saveAuthoritative(snapshot);
}

export async function loadSaleTicketSnapshot(
  saleId: string,
): Promise<SaleTicketSnapshot | null> {
  const normalizedOperationId = normalizeOperationId(saleId);
  if (!normalizedOperationId) return null;
  const stored = await storeLoad<unknown>(
    getSaleTicketStorageKey(normalizedOperationId),
  );
  return parseSaleTicketSnapshot(stored, normalizedOperationId);
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
