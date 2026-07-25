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
const MAX_DISPLAY_ERROR_LENGTH = 200;
const STOCK_ERROR_COPY =
  'Odoo rechazó la venta por stock insuficiente. Revisa las existencias en Sincronización.';
const NETWORK_ERROR_COPY =
  'No se pudo enviar la venta por un problema de conexión. Revisa el estado en Sincronización.';
const GENERIC_ERROR_COPY =
  'No se pudo sincronizar la venta. Revisa la operación en Sincronización.';

const STOCK_ERROR_PATTERN =
  /insufficient[_ -]?stock|stock insuficiente/i;
const NETWORK_ERROR_PATTERNS = [
  /\bnetwork (?:request failed|error)\b/i,
  /\bfailed to fetch\b/i,
  /\bload failed\b/i,
  /\binternet connection appears to be offline\b/i,
  /\bsin conexi[oó]n\b/i,
  /\boffline\b/i,
  /\btime(?:d\s*out|out)\b/i,
  /\b(?:etimedout|econnreset|econnrefused|enotfound|ehostunreach|enetunreach)\b/i,
  /\bconnection (?:was )?(?:lost|failed|reset|refused|closed)\b/i,
  /^http 5\d\d\b/i,
  /\b(?:bad gateway|service unavailable|gateway timeout)\b/i,
];
const EXPLICIT_ZONE_ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

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

function mapSaleQueueErrorForDisplay(value: unknown): string {
  const rawMessage = typeof value === 'string' ? value : '';
  const copy = STOCK_ERROR_PATTERN.test(rawMessage)
    ? STOCK_ERROR_COPY
    : NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(rawMessage))
      ? NETWORK_ERROR_COPY
      : GENERIC_ERROR_COPY;
  return copy.slice(0, MAX_DISPLAY_ERROR_LENGTH);
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

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function ticketCreatedAtMs(ticket: SaleTicketSnapshot | null | undefined): number | null {
  if (typeof ticket?.createdAt !== 'string' || ticket.createdAt.trim().length === 0) {
    return null;
  }
  const normalized = ticket.createdAt.trim();
  const match = EXPLICIT_ZONE_ISO_DATETIME_PATTERN.exec(normalized);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[7];
  const normalizedZone = zone === 'Z' ? '' : zone.slice(1).replace(':', '');
  const offsetHour = normalizedZone ? Number(normalizedZone.slice(0, 2)) : 0;
  const offsetMinute = normalizedZone ? Number(normalizedZone.slice(2, 4)) : 0;
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function queueCreatedAtMs(value: unknown): number {
  return nonNegativeFiniteNumber(value) ?? 0;
}

function matchingTicket(
  ticket: SaleTicketSnapshot | null | undefined,
  operationId: string,
): SaleTicketSnapshot | null {
  if (typeof ticket?.saleId !== 'string') return null;
  return ticket.saleId.trim() === operationId ? ticket : null;
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
    default:
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
  const eligibleTicket = matchingTicket(ticket, operationId);
  const customerName =
    normalizeDisplayString(eligibleTicket?.customerName)
    ?? normalizeDisplayString(payload._clientCustomerName)
    ?? FALLBACK_CUSTOMER_NAME;
  const amountTotal =
    nonNegativeFiniteNumber(eligibleTicket?.total)
    ?? nonNegativeFiniteNumber(payload._clientTotal);
  const kgTotal =
    nonNegativeFiniteNumber(eligibleTicket?.totalKg)
    ?? payloadKilograms(payload);
  const createdAtMs =
    ticketCreatedAtMs(eligibleTicket)
    ?? queueCreatedAtMs(queueItem.created_at);
  const errorMessage =
    localStatus === 'retrying' || localStatus === 'needs_attention'
      ? mapSaleQueueErrorForDisplay(queueItem.error_message)
      : null;

  return {
    key: `local:${operationId}`,
    operationId,
    origin: 'local',
    customerName,
    amountTotal,
    kgTotal,
    createdAtMs,
    localStatus,
    errorMessage,
  };
}
