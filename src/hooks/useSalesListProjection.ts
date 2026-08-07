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
 *
 * El rastreo de transiciones (estados previos + completadas-en-sesión) se
 * deriva DURANTE EL RENDER (patrón oficial de React de estado derivado con
 * setState en fase de render): el mismo render que trae la transición a
 * `done` ya proyecta la tarjeta "Actualizando" — sin ventana visual entre
 * render y efecto (P2 Codex #62). React re-renderiza antes de pintar y la
 * derivación es idempotente (segunda pasada: firma igual ⇒ no re-deriva),
 * seguro también bajo StrictMode.
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

interface ProjectionTracking {
  /** Última firma de cola procesada; null = aún sin observación (mount). */
  signature: string | null;
  /** Estado por operation_id de los sale_order en la última observación. */
  statuses: Map<string, ObservedSaleStatus>;
  /**
   * Operaciones cuya llegada a `done` se observó EN ESTA SESIÓN: solo esas
   * proyectan la tarjeta transitoria "Actualizando". Un done rehidratado de
   * una sesión anterior nunca proyecta ni dispara refresh (P1 Codex #62).
   */
  sessionCompleted: ReadonlySet<string>;
  /** Se incrementa por cada transición observada a done ⇒ refresh forzado. */
  refreshToken: number;
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

  const [tracking, setTracking] = React.useState<ProjectionTracking>({
    signature: null,
    statuses: new Map(),
    sessionCompleted: new Set(),
    refreshToken: 0,
  });

  // Derivación en render: este render YA usa el set actualizado.
  let sessionCompleted = tracking.sessionCompleted;
  if (tracking.signature !== queueSignature) {
    const current = buildSaleStatusMap(queue);
    const hadPrevious = tracking.signature !== null;
    const previous = hadPrevious ? tracking.statuses : new Map<string, ObservedSaleStatus>();
    sessionCompleted = collectSessionCompletedSales(
      { previous, current },
      tracking.sessionCompleted,
    );
    // El refresh es un side effect: aquí solo se DECIDE (token); el efecto de
    // abajo lo ejecuta tras el commit. Nunca en la primera observación
    // (mount/rehydrate): hadPrevious lo bloquea y el token arranca en 0.
    const shouldRefresh = hadPrevious
      && shouldRefreshSalesAfterQueueChange({ previous, current });
    setTracking({
      signature: queueSignature,
      statuses: current,
      sessionCompleted,
      refreshToken: tracking.refreshToken + (shouldRefresh ? 1 : 0),
    });
  }

  React.useEffect(() => {
    if (tracking.refreshToken === 0) return;
    void loadTodaySales({ force: true });
  }, [tracking.refreshToken, loadTodaySales]);

  React.useEffect(() => {
    let cancelled = false;

    const projectable = selectProjectableSaleItems(queue, sessionCompleted);
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

    return () => {
      cancelled = true;
    };
    // queueSignature captura id/status/error/created_at de los sale_order:
    // cambios de otros tipos de ítem (gps, foto) no disparan este efecto.
    // sessionCompleted deriva de la misma firma, así que la clausura del
    // último render de la pasada siempre ve el set final.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSignature]);

  const localDay = localDayOf(Date.now());

  const entries = React.useMemo(() => {
    const localEntries = selectProjectableSaleItems(queue, sessionCompleted)
      .map((item) => projectLocalSale(item, tickets.get(item.id) ?? null))
      .filter((entry): entry is SalesListEntry => entry !== null);
    return mergeSalesListEntries({
      remoteOrders: orders,
      localEntries,
      localDay,
    });
    // La cola y el set de completadas participan vía queueSignature (el set
    // solo cambia cuando cambia la firma, y la derivación en render garantiza
    // que esta pasada ya usa el valor nuevo); orders/tickets son estados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSignature, tickets, orders, localDay]);

  const localSummary = React.useMemo(() => summarizeLocalSales(entries), [entries]);

  return { entries, localSummary, ticketsLoading };
}
