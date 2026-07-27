import { storeLoad, storeSaveStrict } from '../persistence/storage.ts';
import type {
  ExchangeTicketSnapshot,
} from './exchangeTicket.ts';
import { getExchangeTicketStorageKey } from './exchangeTicket.ts';

export async function saveExchangeTicketSnapshot(snapshot: ExchangeTicketSnapshot): Promise<void> {
  await storeSaveStrict(getExchangeTicketStorageKey(snapshot.snapshotId), snapshot);
}

export async function loadExchangeTicketSnapshot(snapshotId: string): Promise<ExchangeTicketSnapshot | null> {
  return storeLoad<ExchangeTicketSnapshot>(getExchangeTicketStorageKey(snapshotId));
}
