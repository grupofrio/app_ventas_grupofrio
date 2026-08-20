/**
 * Proyección de ventas para la pestaña Ventas: combina pedidos remotos de Odoo
 * con ventas locales encoladas (sale_order) y sus tickets persistidos.
 *
 * Diseño: docs/superpowers/specs/2026-07-23-pending-sales-projection-design.md
 *
 * Helper PURO / RN-free. La cola sigue siendo la fuente de verdad de estados
 * locales; el ticket es la fuente preferida de nombre/total/kg; el payload
 * (`_clientCustomerName`, `_clientTotal`) es fallback para ventas legacy.
 * Los KPI oficiales NO consumen nada de este módulo.
 */

import type { SyncQueueItem } from '../types/sync';
import type { GFSalesOrder } from './gfLogistics';
import type { SaleTicketSnapshot } from './saleTicket';

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
  priceConfirmationPending?: boolean;
  kgTotal: number | null;
  createdAtMs: number;
  localStatus?: LocalSaleStatus;
  errorMessage?: string | null;
  remoteOrder?: GFSalesOrder;
  /** F1.13: chip de forma de pago en la tarjeta — 'Efectivo' / 'Crédito'. */
  paymentMethodLabel?: string | null;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  credit: 'Crédito',
  efectivo: 'Efectivo',
  transferencia: 'Crédito',
};

export interface LocalSalesSummary {
  count: number;
  knownAmountTotal: number;
  unknownAmountCount: number;
  needsAttentionCount: number;
}

export const LEGACY_CUSTOMER_NAME = 'Cliente sin nombre';

const QUEUE_STATUS_TO_LOCAL: Record<string, LocalSaleStatus> = {
  pending: 'pending',
  syncing: 'syncing',
  error: 'retrying',
  dead: 'needs_attention',
  done: 'updating',
};

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Normaliza un operation_id SOLO para comparar/deduplicar. El valor original
 * se conserva para API, almacenamiento e impresión.
 */
export function normalizeOperationIdForComparison(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Adapta un ítem `sale_order` de la cola a una tarjeta de venta local.
 * Devuelve null para cualquier otro tipo. El ticket persistido (si existe)
 * es la fuente preferida de nombre, total y kilogramos.
 */
export function projectLocalSale(
  item: Pick<SyncQueueItem, 'id' | 'type' | 'status' | 'payload' | 'created_at' | 'error_message'>,
  ticket?: SaleTicketSnapshot | null,
): SalesListEntry | null {
  if (item.type !== 'sale_order') return null;
  const localStatus = QUEUE_STATUS_TO_LOCAL[item.status];
  if (!localStatus) return null;

  const payload = (item.payload ?? {}) as Record<string, unknown>;
  const payloadName = strOrNull(payload._clientCustomerName);
  const payloadTotal = numOrNull(payload._clientTotal);
  const priceConfirmationPending = ticket?.priceConfirmationPending === true
    || payload._clientPriceConfirmation === 'pending_confirmation';
  const payloadPaymentMethod = strOrNull(payload.payment_method);

  return {
    key: `local:${item.id}`,
    operationId: item.id,
    origin: 'local',
    customerName: ticket?.customerName ?? payloadName ?? LEGACY_CUSTOMER_NAME,
    amountTotal: priceConfirmationPending ? null : (ticket ? ticket.total : payloadTotal),
    priceConfirmationPending,
    kgTotal: ticket ? ticket.totalKg : null,
    createdAtMs: item.created_at,
    localStatus,
    errorMessage: localStatus === 'retrying' || localStatus === 'needs_attention'
      ? (strOrNull(item.error_message) ?? null)
      : null,
    paymentMethodLabel: payloadPaymentMethod
      ? PAYMENT_METHOD_LABELS[payloadPaymentMethod.toLowerCase()] ?? null
      : null,
  };
}

export function projectRemoteSale(order: GFSalesOrder): SalesListEntry {
  const operationId = typeof order.operation_id === 'string' ? order.operation_id : '';
  return {
    key: operationId.trim() ? `remote:${operationId}` : `odoo:${order.id}`,
    operationId,
    origin: 'odoo',
    customerName: order.partner_name,
    amountTotal: order.amount_total,
    kgTotal: order.kg_total,
    createdAtMs: parseOdooDateMs(order.date_order),
    remoteOrder: order,
    paymentMethodLabel: order.payment_method_label
      || (order.payment_method ? PAYMENT_METHOD_LABELS[order.payment_method.toLowerCase()] ?? null : null),
  };
}

/**
 * Odoo devuelve datetimes naive en UTC ("YYYY-MM-DD HH:MM:SS").
 * Solo se usa para ORDENAR la lista, nunca para mostrar.
 */
function parseOdooDateMs(value: string): number {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** Día local (dispositivo) de un timestamp ms, como 'YYYY-MM-DD'. */
export function localDayOf(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface MergeSalesListInput {
  remoteOrders: GFSalesOrder[];
  localEntries: SalesListEntry[];
  /** Día local de la pantalla ('YYYY-MM-DD'). Filtra tarjetas LOCALES de otros días. */
  localDay: string;
}

/**
 * Combina y deduplica por operation_id normalizado (no vacío). El pedido
 * remoto gana. Pedidos remotos con operation_id vacío no participan en la
 * conciliación (clave `odoo:<id>`, permanecen separados). Orden final por
 * fecha descendente. El servidor ya limita la lista remota al día operativo;
 * el filtro de día local aplica solo a las tarjetas locales.
 */
export function mergeSalesListEntries(input: MergeSalesListInput): SalesListEntry[] {
  const remoteEntries = input.remoteOrders.map(projectRemoteSale);

  const remoteIndex = new Set<string>();
  for (const entry of remoteEntries) {
    const normalized = normalizeOperationIdForComparison(entry.operationId);
    if (normalized) remoteIndex.add(normalized);
  }

  const localEntries = input.localEntries.filter((entry) => {
    if (entry.origin !== 'local') return false;
    if (localDayOf(entry.createdAtMs) !== input.localDay) return false;
    const normalized = normalizeOperationIdForComparison(entry.operationId);
    // El pedido remoto gana: si Odoo ya lo devolvió, la tarjeta local se retira.
    return !(normalized && remoteIndex.has(normalized));
  });

  return [...remoteEntries, ...localEntries]
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/**
 * Resumen independiente de pendientes. Suma montos conocidos de
 * pending/syncing/retrying; `needs_attention` cuenta aparte y nunca entra al
 * monto pendiente; `updating` ya fue aceptado por Odoo y no cuenta. El resumen
 * oficial (GFSalesSummary) NO es entrada de esta función.
 */
export function summarizeLocalSales(entries: SalesListEntry[]): LocalSalesSummary {
  let count = 0;
  let knownAmountTotal = 0;
  let unknownAmountCount = 0;
  let needsAttentionCount = 0;

  for (const entry of entries) {
    if (entry.origin !== 'local' || !entry.localStatus) continue;
    if (entry.localStatus === 'needs_attention') {
      needsAttentionCount += 1;
      continue;
    }
    if (entry.localStatus === 'updating') continue;
    count += 1;
    if (entry.amountTotal === null) unknownAmountCount += 1;
    else knownAmountTotal += entry.amountTotal;
  }

  return { count, knownAmountTotal, unknownAmountCount, needsAttentionCount };
}
