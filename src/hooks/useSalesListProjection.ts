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
import {
  collectLocalSaleOperationIds,
  selectProjectableSaleItems,
} from '../services/localSaleTickets';
import {
  mergeSalesListEntries,
  projectLocalSale,
  summarizeLocalSales,
  localDayOf,
  type LocalSalesSummary,
  type SalesListEntry,
} from '../services/salesListProjection';
import {
  collectSessionCompletedSales,
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
  // Operaciones cuya llegada a `done` se observó EN ESTA SESIÓN: solo esas
  // proyectan la tarjeta transitoria "Actualizando". Un done rehidratado de
  // una sesión anterior nunca proyecta ni dispara refresh (P1 Codex #62).
  const sessionCompletedRef = React.useRef<ReadonlySet<string>>(new Set());

  React.useEffect(() => {
    let cancelled = false;

    const current = buildSaleStatusMap(queue);
    const previous = previousStatusesRef.current ?? new Map<string, ObservedSaleStatus>();
    const hadPrevious = previousStatusesRef.current !== null;
    previousStatusesRef.current = current;
    sessionCompletedRef.current = collectSessionCompletedSales(
      { previous, current },
      sessionCompletedRef.current,
    );

    const projectable = selectProjectableSaleItems(queue, sessionCompletedRef.current);
    const operationIds = collectLocalSaleOperationIds(projectable);
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

    if (hadPrevious && shouldRefreshSalesAfterQueueChange({ previous, current })) {
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
    const localEntries = selectProjectableSaleItems(queue, sessionCompletedRef.current)
      .map((item) => projectLocalSale(item, tickets.get(item.id) ?? null))
      .filter((entry): entry is SalesListEntry => entry !== null);
    return mergeSalesListEntries({
      remoteOrders: orders,
      localEntries,
      localDay,
    });
    // La cola participa vía queueSignature (mismos campos que alteran la
    // proyección, y el efecto de arriba ya actualizó sessionCompletedRef);
    // orders/tickets son estados propios.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSignature, tickets, orders, localDay]);

  const localSummary = React.useMemo(() => summarizeLocalSales(entries), [entries]);

  return { entries, localSummary, ticketsLoading };
}
