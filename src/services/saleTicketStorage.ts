import {
  storeLoad,
  storeLoadStrict,
  storeSaveStrict,
} from '../persistence/storage.ts';
import {
  getSaleTicketStorageKey,
  normalizeOdooFolio,
  type SaleTicketSnapshot,
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

export function normalizeStoredSaleTicketSnapshot(
  snapshot: StoredSaleTicketSnapshot,
): SaleTicketSnapshot {
  return {
    ...snapshot,
    odooFolio: normalizeOdooFolio(snapshot.odooFolio),
    sellerName: normalizeSellerName(
      typeof snapshot.sellerName === 'string' ? snapshot.sellerName : undefined,
    ),
  };
}

export function mergeStoredSaleTicketSnapshot(
  current: StoredSaleTicketSnapshot | null,
  incoming: StoredSaleTicketSnapshot,
): SaleTicketSnapshot {
  const normalizedIncoming = normalizeStoredSaleTicketSnapshot(incoming);
  if (current === null) return normalizedIncoming;

  const normalizedCurrent = normalizeStoredSaleTicketSnapshot(current);
  return {
    ...normalizedIncoming,
    odooFolio: normalizedIncoming.odooFolio ?? normalizedCurrent.odooFolio,
  };
}

export async function saveSaleTicketSnapshot(
  snapshot: SaleTicketSnapshot,
  storage: SaleTicketStorageAdapter = defaultStrictStorageAdapter,
): Promise<void> {
  await serializeCriticalSaleTicketOperation(snapshot.saleId, async () => {
    const key = getSaleTicketStorageKey(snapshot.saleId);
    const current = await storage.load<StoredSaleTicketSnapshot>(key);
    const merged = mergeStoredSaleTicketSnapshot(current, snapshot);
    await storage.save(key, merged);
  });
}

export async function promoteStoredSaleTicketOdooFolio(
  saleId: string,
  odooFolio: string,
  storage: SaleTicketStorageAdapter = defaultStrictStorageAdapter,
): Promise<'updated' | 'missing'> {
  return serializeCriticalSaleTicketOperation(saleId, async () => {
    const key = getSaleTicketStorageKey(saleId);
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

export async function loadSaleTicketSnapshot(saleId: string): Promise<SaleTicketSnapshot | null> {
  const snapshot = await storeLoad<StoredSaleTicketSnapshot>(getSaleTicketStorageKey(saleId));
  if (!snapshot) return null;
  return normalizeStoredSaleTicketSnapshot(snapshot);
}

export async function loadSaleTicketSnapshotStrict(
  saleId: string,
): Promise<SaleTicketSnapshot | null> {
  const snapshot = await storeLoadStrict<StoredSaleTicketSnapshot>(
    getSaleTicketStorageKey(saleId),
  );
  if (snapshot === null) return null;
  return normalizeStoredSaleTicketSnapshot(snapshot);
}
