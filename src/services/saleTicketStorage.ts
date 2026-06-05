import { storeLoad, storeSave } from '../persistence/storage';
import { getSaleTicketStorageKey, SaleTicketSnapshot, SALE_TICKET_DEFAULT_SELLER } from './saleTicket';

export async function saveSaleTicketSnapshot(snapshot: SaleTicketSnapshot): Promise<void> {
  await storeSave(getSaleTicketStorageKey(snapshot.saleId), snapshot);
}

export async function loadSaleTicketSnapshot(saleId: string): Promise<SaleTicketSnapshot | null> {
  const snapshot = await storeLoad<SaleTicketSnapshot>(getSaleTicketStorageKey(saleId));
  if (!snapshot) return null;
  return {
    ...snapshot,
    sellerName: typeof snapshot.sellerName === 'string' && snapshot.sellerName.trim().length > 0
      ? snapshot.sellerName
      : SALE_TICKET_DEFAULT_SELLER,
  };
}
