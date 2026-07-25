import { useEffect, useMemo, useRef, useState } from 'react';

import { loadSaleTicketSnapshots } from '../services/saleTicketStorage';
import { collectLocalSaleOperationIds } from '../services/localSaleTickets';
import {
  mergeSalesListEntries,
  projectLocalSale,
  summarizeLocalSales,
  type LocalSalesSummary,
  type SalesListEntry,
} from '../services/salesListProjection';
import { shouldRefreshSalesAfterQueueChange } from '../services/salesRefreshPolicy';
import { useSalesStore } from '../stores/useSalesStore';
import { useSyncStore } from '../stores/useSyncStore';
import type { SaleTicketSnapshot } from '../services/saleTicket';
import type { SyncItemStatus, SyncQueueItem } from '../types/sync';
import { todayLocalISO } from '../utils/localDate';

const ACTIVE_LOCAL_SALE_STATUSES = new Set<SyncItemStatus>([
  'pending',
  'syncing',
  'error',
  'dead',
]);

interface SalesListProjectionResult {
  entries: SalesListEntry[];
  localSummary: LocalSalesSummary;
  ticketsLoading: boolean;
}

function buildLocalSalesTicketSignature(queue: SyncQueueItem[]): string {
  const relevantItems: Array<[
    string,
    SyncItemStatus,
    string | null,
    number,
  ]> = [];

  for (const item of queue) {
    if (
      item.type !== 'sale_order'
      || !ACTIVE_LOCAL_SALE_STATUSES.has(item.status)
      || typeof item.id !== 'string'
      || !item.id.trim()
    ) {
      continue;
    }

    relevantItems.push([
      item.id,
      item.status,
      item.error_message,
      item.created_at,
    ]);
  }

  return JSON.stringify(relevantItems);
}

export function useSalesListProjection(): SalesListProjectionResult {
  const queue = useSyncStore((state) => state.queue);
  const orders = useSalesStore((state) => state.orders);
  const loadTodaySales = useSalesStore((state) => state.loadTodaySales);
  const [tickets, setTickets] = useState<Map<string, SaleTicketSnapshot>>(
    () => new Map(),
  );
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const ticketLoadGenerationRef = useRef(0);
  const previousQueueRef = useRef<SyncQueueItem[] | null>(null);
  const hasObservedQueueRef = useRef(false);

  const ticketSignature = useMemo(
    () => buildLocalSalesTicketSignature(queue),
    [queue],
  );

  useEffect(() => {
    let active = true;
    const generation = ++ticketLoadGenerationRef.current;
    const operationIds = collectLocalSaleOperationIds(queue);

    if (operationIds.length === 0) {
      setTickets(new Map());
      setTicketsLoading(false);
      return () => {
        active = false;
      };
    }

    setTicketsLoading(true);
    void Promise.resolve()
      .then(() => loadSaleTicketSnapshots(operationIds))
      .then((loadedTickets) => {
        if (
          !active
          || generation !== ticketLoadGenerationRef.current
        ) {
          return;
        }
        setTickets(loadedTickets);
      })
      .catch(() => {
        if (
          !active
          || generation !== ticketLoadGenerationRef.current
        ) {
          return;
        }
        setTickets(new Map());
      })
      .finally(() => {
        if (
          !active
          || generation !== ticketLoadGenerationRef.current
        ) {
          return;
        }
        setTicketsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [ticketSignature]);

  useEffect(() => {
    if (!hasObservedQueueRef.current) {
      hasObservedQueueRef.current = true;
      previousQueueRef.current = queue;
      return;
    }

    const previousQueue = previousQueueRef.current;
    previousQueueRef.current = queue;
    if (
      shouldRefreshSalesAfterQueueChange(
        previousQueue,
        queue,
      )
    ) {
      void loadTodaySales({ force: true }).catch(() => undefined);
    }
  }, [loadTodaySales, queue]);

  const localEntries = useMemo(
    () => queue
      .map((item) => projectLocalSale(item, tickets.get(item.id)))
      .filter((entry): entry is SalesListEntry => entry !== null),
    [queue, tickets],
  );
  const localDay = todayLocalISO();
  const entries = useMemo(
    () => mergeSalesListEntries({
      remoteOrders: orders,
      localEntries,
      localDay,
    }),
    [localDay, localEntries, orders],
  );
  const localSummary = useMemo(
    () => summarizeLocalSales(localEntries),
    [localEntries],
  );

  return { entries, localSummary, ticketsLoading };
}
