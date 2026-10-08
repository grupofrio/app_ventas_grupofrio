import { storeLoad, storeSaveStrict } from '../persistence/storage.ts';
import {
  applyExchangeServerIdentity,
  getExchangeTicketStorageKey,
  orderExchangeTicketsForReprint,
  refreshExchangeTicketFolio,
  type ExchangeTicketSnapshot,
} from './exchangeTicket.ts';

export const EXCHANGE_TICKET_INDEX_KEY = 'exchange-ticket-index';

export async function saveExchangeTicketSnapshot(snapshot: ExchangeTicketSnapshot): Promise<void> {
  await storeSaveStrict(getExchangeTicketStorageKey(snapshot.snapshotId), snapshot);
  try {
    await rememberExchangeTicketId(snapshot.snapshotId);
  } catch {
    // The ticket itself is durable. A missing index must not look like a failed cambio.
  }
}

export async function loadExchangeTicketSnapshot(snapshotId: string): Promise<ExchangeTicketSnapshot | null> {
  const stored = await storeLoad<ExchangeTicketSnapshot>(getExchangeTicketStorageKey(snapshotId));
  if (!stored) return null;
  return refreshExchangeTicketFolio(stored);
}

export async function listExchangeTicketIds(): Promise<string[]> {
  const current = await storeLoad<unknown>(EXCHANGE_TICKET_INDEX_KEY);
  if (!Array.isArray(current)) return [];
  return current.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export async function listExchangeTicketSnapshots(): Promise<ExchangeTicketSnapshot[]> {
  const ids = await listExchangeTicketIds();
  const snapshots: ExchangeTicketSnapshot[] = [];
  for (const id of ids) {
    const snapshot = await loadExchangeTicketSnapshot(id);
    if (snapshot) snapshots.push(snapshot);
  }
  return orderExchangeTicketsForReprint(snapshots);
}

/**
 * Point a stored ticket at the server folio after offline sync.
 * Missing tickets and storage errors propagate to the caller, which must not
 * fail the exchange: Odoo already accepted the idempotent create.
 */
export async function recordExchangeServerIdentity(
  snapshotId: string,
  identity: { exchangeName: string; exchangeId: number | null },
): Promise<void> {
  const current = await loadExchangeTicketSnapshot(snapshotId);
  if (!current) return;
  await saveExchangeTicketSnapshot(applyExchangeServerIdentity(current, identity));
}

async function rememberExchangeTicketId(snapshotId: string): Promise<void> {
  const ids = await listExchangeTicketIds();
  const next = [snapshotId, ...ids.filter((id) => id !== snapshotId)];
  await storeSaveStrict(EXCHANGE_TICKET_INDEX_KEY, next);
}
