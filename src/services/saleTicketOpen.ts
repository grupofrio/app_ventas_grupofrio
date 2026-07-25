import {
  buildSaleTicketSnapshotFromOrder,
  mergeSaleTicketFromOrder,
  type SaleTicketOrderSource,
  type SaleTicketSnapshot,
} from './saleTicket.ts';

export type SaleTicketOpenResult = 'opened' | 'failed';

export interface SaleTicketOpenDependencies {
  load: (saleId: string) => Promise<SaleTicketSnapshot | null>;
  save: (snapshot: SaleTicketSnapshot) => Promise<void>;
  navigate: (saleId: string) => void | Promise<void>;
  onError: (error: unknown) => void | Promise<void>;
}

export async function openSaleTicketForOrder(
  order: SaleTicketOrderSource,
  dependencies: SaleTicketOpenDependencies,
): Promise<SaleTicketOpenResult> {
  try {
    const authoritative = buildSaleTicketSnapshotFromOrder(order);
    const current = await dependencies.load(authoritative.saleId);
    const merged = mergeSaleTicketFromOrder(current, order);
    await dependencies.save(merged);
    await dependencies.navigate(merged.saleId);
    return 'opened';
  } catch (error) {
    try {
      await dependencies.onError(error);
    } catch {
      // Error feedback must not turn a handled ticket failure into a rejection.
    }
    return 'failed';
  }
}
