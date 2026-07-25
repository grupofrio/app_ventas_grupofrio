import type { SaleTicketSnapshot } from './saleTicket.ts';
import {
  normalizeOperationIdForComparison,
  projectLocalSale,
  type SalesListEntry,
} from './salesListProjection.ts';
import type { SyncQueueItem } from '../types/sync.ts';

export interface CompletedSaleRetentionInput {
  retainedCompletedEntries: ReadonlyMap<string, SalesListEntry>;
  previousLocalEntries: readonly SalesListEntry[];
  queue: readonly SyncQueueItem[];
  tickets: ReadonlyMap<string, SaleTicketSnapshot>;
  remoteEntries: readonly SalesListEntry[];
}

const ACTIVE_STATUSES = new Set([
  'pending',
  'syncing',
  'error',
  'dead',
]);

function normalizedOperationId(value: unknown): string {
  return typeof value === 'string'
    ? normalizeOperationIdForComparison(value)
    : '';
}

function asUpdating(entry: SalesListEntry): SalesListEntry {
  return {
    ...entry,
    localStatus: 'updating',
    errorMessage: null,
  };
}

function ticketForQueueItem(
  tickets: ReadonlyMap<string, SaleTicketSnapshot>,
  queueId: string,
): SaleTicketSnapshot | null {
  const exact = tickets.get(queueId);
  if (exact) return exact;

  const normalizedQueueId = normalizedOperationId(queueId);
  for (const [storedId, candidate] of tickets) {
    if (
      normalizedOperationId(storedId) === normalizedQueueId
      && normalizedOperationId(candidate.saleId) === normalizedQueueId
    ) {
      return candidate;
    }
  }
  return null;
}

function deriveUpdatingEntry(
  item: SyncQueueItem,
  tickets: ReadonlyMap<string, SaleTicketSnapshot>,
): SalesListEntry | null {
  const projected = projectLocalSale(
    { ...item, status: 'pending' },
    ticketForQueueItem(tickets, item.id),
  );
  return projected ? asUpdating(projected) : null;
}

function previousEntriesByOperationId(
  entries: readonly SalesListEntry[],
): Map<string, SalesListEntry> {
  const byOperationId = new Map<string, SalesListEntry>();
  for (const entry of entries) {
    if (entry.origin !== 'local') continue;
    const operationId = normalizedOperationId(entry.operationId);
    if (!operationId || byOperationId.has(operationId)) continue;
    byOperationId.set(operationId, entry);
  }
  return byOperationId;
}

export function reconcileCompletedSaleRetention(
  input: CompletedSaleRetentionInput,
): Map<string, SalesListEntry> {
  const remoteOperationIds = new Set<string>();
  for (const entry of input.remoteEntries) {
    if (entry.origin !== 'odoo') continue;
    const operationId = normalizedOperationId(entry.operationId);
    if (operationId) remoteOperationIds.add(operationId);
  }

  const activeOperationIds = new Set<string>();
  for (const item of input.queue) {
    if (
      item.type !== 'sale_order'
      || !ACTIVE_STATUSES.has(item.status)
    ) {
      continue;
    }
    const operationId = normalizedOperationId(item.id);
    if (operationId) activeOperationIds.add(operationId);
  }

  const next = new Map<string, SalesListEntry>();
  for (const entry of input.retainedCompletedEntries.values()) {
    const operationId = normalizedOperationId(entry.operationId);
    if (
      entry.origin !== 'local'
      || !operationId
      || remoteOperationIds.has(operationId)
      || activeOperationIds.has(operationId)
      || next.has(operationId)
    ) {
      continue;
    }
    next.set(operationId, asUpdating(entry));
  }

  const previousByOperationId = previousEntriesByOperationId(
    input.previousLocalEntries,
  );
  for (const item of input.queue) {
    if (item.type !== 'sale_order' || item.status !== 'done') continue;

    const operationId = normalizedOperationId(item.id);
    if (!operationId || remoteOperationIds.has(operationId)) continue;

    const previous = previousByOperationId.get(operationId);
    const derived = deriveUpdatingEntry(item, input.tickets);
    const retained = next.get(operationId);
    const source = previous && previous.localStatus !== 'updating'
      ? previous
      : ticketForQueueItem(input.tickets, item.id)
        ? derived
        : retained ?? previous ?? derived;
    if (source) next.set(operationId, asUpdating(source));
  }

  return next;
}
