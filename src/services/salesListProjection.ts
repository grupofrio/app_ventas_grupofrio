import type { GFSalesOrder } from './gfLogistics.ts';
import type { SaleTicketSnapshot } from './saleTicket.ts';
import type { SyncQueueItem, SyncItemStatus } from '../types/sync.ts';

export type LocalSaleStatus =
  | 'pending'
  | 'syncing'
  | 'retrying'
  | 'needs_attention'
  | 'updating';

export interface SalesListEntry {
  key: string;
  operationId: string;
  origin: 'odoo' | 'local';
  customerName: string;
  amountTotal: number | null;
  kgTotal: number | null;
  createdAtMs: number;
  localStatus?: LocalSaleStatus;
  errorMessage?: string | null;
  remoteOrder?: GFSalesOrder;
}

const FALLBACK_CUSTOMER_NAME = 'Cliente sin nombre';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDisplayString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function nonNegativeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function ticketCreatedAtMs(ticket: SaleTicketSnapshot | null | undefined): number | null {
  if (typeof ticket?.createdAt !== 'string' || ticket.createdAt.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(ticket.createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function queueCreatedAtMs(value: unknown): number {
  return nonNegativeFiniteNumber(value) ?? 0;
}

function lineKilograms(line: Record<string, unknown>): number | null {
  const persistedTotal =
    nonNegativeFiniteNumber(line.kg_total)
    ?? nonNegativeFiniteNumber(line.weight_total);
  if (persistedTotal !== null) return persistedTotal;

  const quantity =
    positiveFiniteNumber(line.quantity)
    ?? positiveFiniteNumber(line.qty);
  const unitWeight = nonNegativeFiniteNumber(line.weight);
  if (quantity === null || unitWeight === null) return null;

  const total = quantity * unitWeight;
  return Number.isFinite(total) ? total : null;
}

function payloadKilograms(payload: Record<string, unknown>): number | null {
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) return null;

  let total = 0;
  for (const candidate of payload.lines) {
    if (!isRecord(candidate)) return null;
    const kilograms = lineKilograms(candidate);
    if (kilograms === null) return null;
    total += kilograms;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function projectStatus(status: SyncItemStatus): LocalSaleStatus | null {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'syncing':
      return 'syncing';
    case 'error':
      return 'retrying';
    case 'dead':
      return 'needs_attention';
    case 'done':
      return null;
  }
}

export function projectLocalSale(
  queueItem: SyncQueueItem,
  ticket: SaleTicketSnapshot | null | undefined,
): SalesListEntry | null {
  if (queueItem.type !== 'sale_order') return null;

  const operationId = typeof queueItem.id === 'string'
    ? queueItem.id.trim()
    : '';
  if (!operationId) return null;

  const localStatus = projectStatus(queueItem.status);
  if (localStatus === null) return null;

  const payload = isRecord(queueItem.payload) ? queueItem.payload : {};
  const customerName =
    normalizeDisplayString(ticket?.customerName)
    ?? normalizeDisplayString(payload._clientCustomerName)
    ?? FALLBACK_CUSTOMER_NAME;
  const amountTotal =
    nonNegativeFiniteNumber(ticket?.total)
    ?? nonNegativeFiniteNumber(payload._clientTotal);
  const kgTotal =
    nonNegativeFiniteNumber(ticket?.totalKg)
    ?? payloadKilograms(payload);
  const createdAtMs =
    ticketCreatedAtMs(ticket)
    ?? queueCreatedAtMs(queueItem.created_at);

  return {
    key: `local:${operationId}`,
    operationId,
    origin: 'local',
    customerName,
    amountTotal,
    kgTotal,
    createdAtMs,
    localStatus,
    errorMessage: normalizeDisplayString(queueItem.error_message),
  };
}
