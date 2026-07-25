import type { GFSalesOrder } from './gfLogistics.ts';
import {
  parseSaleTicketSnapshot,
  type SaleTicketSnapshot,
} from './saleTicket.ts';
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
  ticketSnapshot?: SaleTicketSnapshot;
  remoteOrder?: GFSalesOrder;
}

export interface MergeSalesListInput {
  remoteOrders: GFSalesOrder[];
  localEntries: SalesListEntry[];
  localDay: string;
}

export interface LocalSalesSummary {
  count: number;
  knownAmountTotal: number;
  unknownAmountCount: number;
  needsAttentionCount: number;
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
const LOCAL_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;
const LOCAL_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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

function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  return year >= 1
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth(year, month);
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
  if (ticket.saleId.trim() !== operationId) return null;
  const canonicalCandidate = ticket.saleId === operationId
    ? ticket
    : { ...ticket, saleId: operationId };
  return parseSaleTicketSnapshot(canonicalCandidate, operationId)
    ? ticket
    : null;
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

export function normalizeOperationIdForComparison(value: string): string {
  return value.trim().toLowerCase();
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
    ...(eligibleTicket ? { ticketSnapshot: eligibleTicket } : {}),
  };
}

function validRemoteOrderId(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    ? value
    : null;
}

function safeRemoteString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeRemoteNumber(value: unknown): number {
  return nonNegativeFiniteNumber(value) ?? 0;
}

function safeRemoteNullableNumber(value: unknown): number | null {
  return positiveFiniteNumber(value);
}

function sanitizeRemoteLine(value: unknown): GFSalesOrder['lines'][number] {
  const line = isRecord(value) ? value : {};
  return {
    product_id: safeRemoteNumber(line.product_id),
    product_name: safeRemoteString(line.product_name),
    quantity: safeRemoteNumber(line.quantity),
    price_unit: safeRemoteNumber(line.price_unit),
    price_subtotal: safeRemoteNumber(line.price_subtotal),
    kg_total: safeRemoteNumber(line.kg_total),
  };
}

function sanitizeRemoteOrder(
  value: Record<string, unknown>,
  orderId: number,
): GFSalesOrder {
  return {
    id: orderId,
    name: safeRemoteString(value.name),
    partner_id: safeRemoteNullableNumber(value.partner_id),
    partner_name: safeRemoteString(value.partner_name),
    amount_total: safeRemoteNumber(value.amount_total),
    amount_untaxed: safeRemoteNumber(value.amount_untaxed),
    amount_tax: safeRemoteNumber(value.amount_tax),
    kg_total: safeRemoteNumber(value.kg_total),
    state: safeRemoteString(value.state),
    date_order: safeRemoteString(value.date_order),
    confirmation_date: safeRemoteString(value.confirmation_date),
    stop_id: safeRemoteNullableNumber(value.stop_id),
    operation_id: safeRemoteString(value.operation_id),
    payment_method: safeRemoteString(value.payment_method),
    payment_method_label: safeRemoteString(value.payment_method_label),
    employee_name: safeRemoteString(value.employee_name),
    lines: Array.isArray(value.lines)
      ? value.lines.map(sanitizeRemoteLine)
      : [],
  };
}

function remoteDateOrderMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const localMatch = LOCAL_DATETIME_PATTERN.exec(normalized);
  if (localMatch) {
    const year = Number(localMatch[1]);
    const month = Number(localMatch[2]);
    const day = Number(localMatch[3]);
    const hour = Number(localMatch[4]);
    const minute = Number(localMatch[5]);
    const second = Number(localMatch[6]);
    const milliseconds = Number(
      (localMatch[7] ?? '').slice(0, 3).padEnd(3, '0'),
    );
    if (
      !isValidCalendarDate(year, month, day)
      || hour > 23
      || minute > 59
      || second > 59
    ) {
      return null;
    }

    const parsed = new Date(0);
    parsed.setHours(0, 0, 0, 0);
    parsed.setFullYear(year, month - 1, day);
    parsed.setHours(hour, minute, second, milliseconds);
    if (
      parsed.getFullYear() !== year
      || parsed.getMonth() !== month - 1
      || parsed.getDate() !== day
      || parsed.getHours() !== hour
      || parsed.getMinutes() !== minute
      || parsed.getSeconds() !== second
    ) {
      return null;
    }
    return parsed.getTime();
  }

  const zonedMatch = EXPLICIT_ZONE_ISO_DATETIME_PATTERN.exec(normalized);
  if (!zonedMatch) return null;

  const year = Number(zonedMatch[1]);
  const month = Number(zonedMatch[2]);
  const day = Number(zonedMatch[3]);
  const hour = Number(zonedMatch[4]);
  const minute = Number(zonedMatch[5]);
  const second = Number(zonedMatch[6]);
  if (
    !isValidCalendarDate(year, month, day)
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function projectRemoteSale(value: unknown): SalesListEntry | null {
  if (!isRecord(value)) return null;

  const orderId = validRemoteOrderId(value.id);
  const createdAtMs = remoteDateOrderMs(value.date_order);
  if (orderId === null || createdAtMs === null) return null;

  const remoteOrder = sanitizeRemoteOrder(value, orderId);
  return {
    key: `odoo:${orderId}`,
    operationId: remoteOrder.operation_id,
    origin: 'odoo',
    customerName:
      normalizeDisplayString(value.partner_name)
      ?? FALLBACK_CUSTOMER_NAME,
    amountTotal: nonNegativeFiniteNumber(value.amount_total),
    kgTotal: nonNegativeFiniteNumber(value.kg_total),
    createdAtMs,
    remoteOrder,
  };
}

function validLocalDay(value: string): boolean {
  const match = LOCAL_DAY_PATTERN.exec(value);
  if (!match) return false;
  return isValidCalendarDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  );
}

function localDayForTimestamp(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}

function compareSalesListEntries(
  left: SalesListEntry,
  right: SalesListEntry,
): number {
  const dateOrder = right.createdAtMs - left.createdAtMs;
  if (dateOrder !== 0) return dateOrder;
  if (left.key < right.key) return -1;
  if (left.key > right.key) return 1;
  return 0;
}

function compareStableStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalString(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return typeof value === 'string'
    ? `string:${value}`
    : 'invalid-string';
}

function canonicalNumber(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'invalid-number';
  }
  return Object.is(value, -0) ? 'number:-0' : `number:${String(value)}`;
}

function canonicalRemoteLine(value: unknown): string[] {
  if (!isRecord(value)) return ['invalid-line'];
  return [
    canonicalNumber(value.product_id),
    canonicalString(value.product_name),
    canonicalNumber(value.quantity),
    canonicalNumber(value.price_unit),
    canonicalNumber(value.price_subtotal),
    canonicalNumber(value.kg_total),
  ];
}

function canonicalRemoteOrder(value: unknown): unknown[] {
  if (!isRecord(value)) return ['missing-remote-order'];
  const lines = Array.isArray(value.lines)
    ? value.lines.map(canonicalRemoteLine)
    : [['invalid-lines']];
  return [
    canonicalNumber(value.id),
    canonicalString(value.name),
    canonicalNumber(value.partner_id),
    canonicalString(value.partner_name),
    canonicalNumber(value.amount_total),
    canonicalNumber(value.amount_untaxed),
    canonicalNumber(value.amount_tax),
    canonicalNumber(value.kg_total),
    canonicalString(value.state),
    canonicalString(value.date_order),
    canonicalString(value.confirmation_date),
    canonicalNumber(value.stop_id),
    canonicalString(value.operation_id),
    canonicalString(value.payment_method),
    canonicalString(value.payment_method_label),
    canonicalString(value.employee_name),
    lines,
  ];
}

function canonicalProjectedRemoteCandidate(entry: SalesListEntry): string {
  return JSON.stringify([
    canonicalString(entry.key),
    canonicalString(entry.operationId),
    canonicalString(entry.origin),
    canonicalString(entry.customerName),
    canonicalNumber(entry.amountTotal),
    canonicalNumber(entry.kgTotal),
    canonicalNumber(entry.createdAtMs),
    canonicalString(entry.localStatus),
    canonicalString(entry.errorMessage),
    canonicalRemoteOrder(entry.remoteOrder),
  ]);
}

function compareProjectedRemoteCandidates(
  left: SalesListEntry,
  right: SalesListEntry,
): number {
  return compareSalesListEntries(left, right)
    || compareStableStrings(
      canonicalProjectedRemoteCandidate(left),
      canonicalProjectedRemoteCandidate(right),
    );
}

export function mergeSalesListEntries(
  input: MergeSalesListInput,
): SalesListEntry[] {
  if (!validLocalDay(input.localDay)) return [];

  const remoteByKey = new Map<string, SalesListEntry>();
  for (const order of input.remoteOrders) {
    const entry = projectRemoteSale(order);
    if (
      entry === null
      || localDayForTimestamp(entry.createdAtMs) !== input.localDay
    ) {
      continue;
    }
    const existing = remoteByKey.get(entry.key);
    if (!existing || compareProjectedRemoteCandidates(entry, existing) < 0) {
      remoteByKey.set(entry.key, entry);
    }
  }

  const blankRemoteByKey = new Map<string, SalesListEntry>();
  const remoteByOperationId = new Map<string, SalesListEntry>();
  for (const entry of remoteByKey.values()) {
    const normalized = normalizeOperationIdForComparison(entry.operationId);
    if (!normalized) {
      blankRemoteByKey.set(entry.key, entry);
      continue;
    }
    const existing = remoteByOperationId.get(normalized);
    if (!existing || compareProjectedRemoteCandidates(entry, existing) < 0) {
      remoteByOperationId.set(normalized, entry);
    }
  }

  const mergedByKey = new Map<string, SalesListEntry>(blankRemoteByKey);
  for (const entry of remoteByOperationId.values()) {
    mergedByKey.set(entry.key, entry);
  }
  for (const entry of input.localEntries) {
    if (
      entry.origin !== 'local'
      || localDayForTimestamp(entry.createdAtMs) !== input.localDay
    ) {
      continue;
    }
    const normalized = normalizeOperationIdForComparison(entry.operationId);
    if (normalized && remoteByOperationId.has(normalized)) continue;
    if (!mergedByKey.has(entry.key)) mergedByKey.set(entry.key, entry);
  }

  return [...mergedByKey.values()].sort(compareSalesListEntries);
}

const AMOUNT_BEARING_LOCAL_STATUSES = new Set<LocalSaleStatus>([
  'pending',
  'syncing',
  'retrying',
  'updating',
]);

function roundedCurrencyCents(value: unknown): number | null {
  const amount = nonNegativeFiniteNumber(value);
  if (amount === null) return null;
  const cents = Math.round((amount + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function summarizeLocalSales(
  entries: SalesListEntry[],
): LocalSalesSummary {
  let count = 0;
  let knownAmountCents = 0;
  let unknownAmountCount = 0;
  let needsAttentionCount = 0;

  for (const entry of entries) {
    if (entry.origin !== 'local') continue;
    count += 1;

    if (entry.localStatus === 'needs_attention') {
      needsAttentionCount += 1;
      unknownAmountCount += 1;
      continue;
    }

    const cents = entry.localStatus
      && AMOUNT_BEARING_LOCAL_STATUSES.has(entry.localStatus)
      ? roundedCurrencyCents(entry.amountTotal)
      : null;
    if (cents === null) {
      unknownAmountCount += 1;
      continue;
    }
    const nextKnownAmountCents = knownAmountCents + cents;
    if (!Number.isSafeInteger(nextKnownAmountCents)) {
      unknownAmountCount += 1;
      continue;
    }
    knownAmountCents = nextKnownAmountCents;
  }

  return {
    count,
    knownAmountTotal: knownAmountCents / 100,
    unknownAmountCount,
    needsAttentionCount,
  };
}
