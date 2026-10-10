/**
 * F42 — decide checkout sale/no_sale from every accepted path, and ask Odoo
 * when the phone is online but nothing local proves the sale yet.
 */

import { fetchSalesList } from './gfLogistics';
import {
  hasSyncedSaleForStop,
  resolveSyncedSaleForStop,
} from './checkoutSaleEvidence';
import { useSalesStore } from '../stores/useSalesStore';
import { useSyncStore } from '../stores/useSyncStore';
import { useVisitStore } from '../stores/useVisitStore';

export async function readHasSyncedSale(stopId: number): Promise<boolean> {
  const queue = useSyncStore.getState().queue;
  const orders = useSalesStore.getState().orders;
  const acceptedSales = useVisitStore.getState().acceptedSales;
  const result = await resolveSyncedSaleForStop({
    stopId,
    queue,
    orders,
    acceptedSales,
    isOnline: useSyncStore.getState().isOnline,
    fetchRemoteOrders: async () => {
      const list = await fetchSalesList();
      useSalesStore.getState().mergeRemoteOrders(list.orders);
      return list.orders;
    },
  });
  return result.hasSyncedSale || hasSyncedSaleForStop(
    stopId,
    useSyncStore.getState().queue,
    useSalesStore.getState().orders,
    useVisitStore.getState().acceptedSales,
  );
}
