/**
 * Hook de la proyección unificada de ventas (pestaña Ventas).
 *
 * - Se suscribe a la cola (useSyncStore) y a los pedidos remotos (useSalesStore).
 * - Carga tickets locales en lote solo cuando cambia la firma relevante de la
 *   cola (id/status/error_message/created_at de sale_order): un GPS encolado
 *   no relee tickets.
 * - Dispara refresco remoto FORZADO únicamente vía
 *   shouldRefreshSalesAfterQueueChange (venta que alcanza `done`).
 * - Si el remoto falla, las tarjetas locales permanecen (el store conserva
 *   además el último summary/orders conocidos).
 */

import React from 'react';
import { useSyncStore } from '../stores/useSyncStore';
import { useSalesStore } from '../stores/useSalesStore';
import type { SaleTicketSnapshot } from '../services/saleTicket';
import { loadSaleTicketSnapshots } from '../services/saleTicketStorage';
import { collectLocalSaleOperationIds } from '../services/localSaleTickets';
import {
  mergeSalesListEntries,
  projectLocalSale,
  summarizeLocalSales,
  localDayOf,
  type LocalSalesSummary,
  type SalesListEntry,
} from '../services/salesListProjection';
import {
  shouldRefreshSalesAfterQueueChange,
  type ObservedSaleStatus,
} from '../services/salesRefreshPolicy';
import { logError } from '../utils/logger';

function buildSaleQueueSignature(
  queue: ReturnType<typeof useSyncStore.getState>['queue'],
): string {
  return queue
    .filter((item) => item.type === 'sale_order')
    .map((item) => `${item.id}|${item.status}|${item.error_message ?? ''}|${item.created_at}`)
    .join('\n');
}

function buildSaleStatusMap(
  queue: ReturnType<typeof useSyncStore.getState>['queue'],
): Map<string, ObservedSaleStatus> {
  const map = new Map<string, ObservedSaleStatus>();
  for (const item of queue) {
    if (item.type !== 'sale_order') continue;
    map.set(item.id, item.status);
  }
  return map;
}

export interface SalesListProjection {
  entries: SalesListEntry[];
  localSummary: LocalSalesSummary;
  ticketsLoading: boolean;
}

export function useSalesListProjection(): SalesListProjection {
  const queue = useSyncStore((s) => s.queue);
  const orders = useSalesStore((s) => s.orders);
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);

  const [tickets, setTickets] = React.useState<Map<string, SaleTicketSnapshot>>(
    () => new Map(),
  );
  const [ticketsLoading, setTicketsLoading] = React.useState(false);

  const queueSignature = buildSaleQueueSignature(queue);
  const previousStatusesRef = React.useRef<Map<string, ObservedSaleStatus> | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const operationIds = collectLocalSaleOperationIds(queue);
    setTicketsLoading(true);
    void loadSaleTicketSnapshots(operationIds)
      .then((loaded) => {
        if (cancelled) return;
        setTickets(loaded);
        setTicketsLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setTicketsLoading(false);
        logError('general', 'sales_projection_tickets_load_failed', {
          message: error instanceof Error ? error.message : 'unknown',
        });
      });

    const current = buildSaleStatusMap(queue);
    const previous = previousStatusesRef.current;
    previousStatusesRef.current = current;
    if (previous && shouldRefreshSalesAfterQueueChange({ previous, current })) {
      void loadTodaySales({ force: true });
    }

    return () => {
      cancelled = true;
    };
    // queueSignature captura id/status/error/created_at de los sale_order:
    // cambios de otros tipos de ítem (gps, foto) no disparan este efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSignature, loadTodaySales]);

  const localDay = localDayOf(Date.now());

  const entries = React.useMemo(() => {
    const localEntries = queue
      .map((item) => projectLocalSale(item, tickets.get(item.id) ?? null))
      .filter((entry): entry is SalesListEntry => entry !== null);
    return mergeSalesListEntries({
      remoteOrders: orders,
      localEntries,
      localDay,
    });
    // La cola participa vía queueSignature (mismos campos que alteran la
    // proyección); orders/tickets son estados propios.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSignature, tickets, orders, localDay]);

  const localSummary = React.useMemo(() => summarizeLocalSales(entries), [entries]);

  return { entries, localSummary, ticketsLoading };
}
