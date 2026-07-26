import { useEffect, useMemo, useRef, useState } from 'react';

import { loadSaleTicketSnapshots } from '../services/saleTicketStorage';
import { collectLocalSaleOperationIds } from '../services/localSaleTickets';
import {
  mergeSalesListEntries,
  normalizeOperationIdForComparison,
  projectLocalSale,
  summarizeLocalSales,
  type LocalSalesSummary,
  type SalesListEntry,
} from '../services/salesListProjection';
import { reconcileCompletedSaleRetention } from '../services/completedSaleRetention';
import { shouldRefreshSalesAfterQueueChange } from '../services/salesRefreshPolicy';
import { useSalesStore } from '../stores/useSalesStore';
import { useSyncStore } from '../stores/useSyncStore';
import type { SaleTicketSnapshot } from '../services/saleTicket';
import type { SyncItemStatus, SyncQueueItem } from '../types/sync';
import { todayLocalISO } from '../utils/localDate';

const PROJECTABLE_LOCAL_SALE_STATUSES = new Set<SyncItemStatus>([
  'pending',
  'syncing',
  'error',
  'dead',
  'done',
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
      || !PROJECTABLE_LOCAL_SALE_STATUSES.has(item.status)
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

function collectProjectionTicketOperationIds(
  queue: SyncQueueItem[],
): string[] {
  const operationIds = collectLocalSaleOperationIds(queue);
  const seen = new Set(
    operationIds.map(normalizeOperationIdForComparison),
  );

  for (const item of queue) {
    if (item.type !== 'sale_order' || item.status !== 'done') continue;
    const normalized = normalizeOperationIdForComparison(item.id);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    operationIds.push(item.id);
  }

  return operationIds;
}

function sameProjectedEntry(
  left: SalesListEntry,
  right: SalesListEntry,
): boolean {
  return left.key === right.key
    && left.operationId === right.operationId
    && left.origin === right.origin
    && left.customerName === right.customerName
    && left.amountTotal === right.amountTotal
    && left.kgTotal === right.kgTotal
    && left.createdAtMs === right.createdAtMs
    && left.localStatus === right.localStatus
    && left.errorMessage === right.errorMessage
    && left.requiresStockRetry === right.requiresStockRetry
    && left.ticketSnapshot === right.ticketSnapshot
    && left.remoteOrder === right.remoteOrder;
}

function sameCompletedEntries(
  left: ReadonlyMap<string, SalesListEntry>,
  right: ReadonlyMap<string, SalesListEntry>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [operationId, entry] of left) {
    const candidate = right.get(operationId);
    if (!candidate || !sameProjectedEntry(entry, candidate)) return false;
  }
  return true;
}

export function useSalesListProjection(): SalesListProjectionResult {
  const queue = useSyncStore((state) => state.queue);
  const orders = useSalesStore((state) => state.orders);
  const loadTodaySales = useSalesStore((state) => state.loadTodaySales);
  const [tickets, setTickets] = useState<Map<string, SaleTicketSnapshot>>(
    () => new Map(),
  );
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [retainedCompletedEntries, setRetainedCompletedEntries] = useState<
    Map<string, SalesListEntry>
  >(() => new Map());
  const ticketLoadGenerationRef = useRef(0);
  const previousQueueRef = useRef<SyncQueueItem[] | null>(null);
  const previousLocalEntriesRef = useRef<SalesListEntry[]>([]);
  const hasObservedQueueRef = useRef(false);

  const ticketSignature = useMemo(
    () => buildLocalSalesTicketSignature(queue),
    [queue],
  );

  useEffect(() => {
    let active = true;
    const generation = ++ticketLoadGenerationRef.current;
    const operationIds = collectProjectionTicketOperationIds(queue);

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

  const localDay = todayLocalISO();
  const visibleRemoteEntries = useMemo(
    () => mergeSalesListEntries({
      remoteOrders: orders,
      localEntries: [],
      localDay,
    }),
    [localDay, orders],
  );
  const activeLocalEntries = useMemo(
    () => queue
      .map((item) => projectLocalSale(item, tickets.get(item.id)))
      .filter((entry): entry is SalesListEntry => entry !== null),
    [queue, tickets],
  );
  const projectedRetainedCompletedEntries = useMemo(
    () => reconcileCompletedSaleRetention({
      retainedCompletedEntries,
      previousLocalEntries: previousLocalEntriesRef.current,
      queue,
      tickets,
      remoteEntries: visibleRemoteEntries,
    }),
    [queue, retainedCompletedEntries, tickets, visibleRemoteEntries],
  );

  useEffect(() => {
    const projectedEntries = [
      ...activeLocalEntries,
      ...projectedRetainedCompletedEntries.values(),
    ];
    previousLocalEntriesRef.current = projectedEntries;
    setRetainedCompletedEntries((current) => (
      sameCompletedEntries(current, projectedRetainedCompletedEntries)
        ? current
        : projectedRetainedCompletedEntries
    ));
  }, [activeLocalEntries, projectedRetainedCompletedEntries]);

  const localEntries = useMemo(
    () => [
      ...activeLocalEntries,
      ...projectedRetainedCompletedEntries.values(),
    ],
    [activeLocalEntries, projectedRetainedCompletedEntries],
  );
  const entries = useMemo(
    () => mergeSalesListEntries({
      remoteOrders: orders,
      localEntries,
      localDay,
    }),
    [localDay, localEntries, orders],
  );
  const visibleLocalEntries = useMemo(
    () => entries.filter((entry) => entry.origin === 'local'),
    [entries],
  );
  const localSummary = useMemo(
    () => summarizeLocalSales(visibleLocalEntries),
    [visibleLocalEntries],
  );

  return { entries, localSummary, ticketsLoading };
}
