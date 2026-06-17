/**
 * Resumen de pedidos (sale_order) sin sincronizar, para indicadores de UI
 * (banner en ruta). Helper PURO / RN-free. Un "pedido pendiente de envío" es un
 * sale_order encolado offline que aún no llegó a Odoo.
 */
import type { SyncQueueItem } from '../types/sync';

export interface PendingOrdersSummary {
  pending: number; // pending | syncing
  failed: number;  // error | dead
  total: number;
}

export function summarizePendingOrders(
  queue: Array<Pick<SyncQueueItem, 'type' | 'status'>>,
): PendingOrdersSummary {
  let pending = 0;
  let failed = 0;
  for (const item of queue) {
    if (item.type !== 'sale_order') continue;
    if (item.status === 'pending' || item.status === 'syncing') pending += 1;
    else if (item.status === 'error' || item.status === 'dead') failed += 1;
  }
  return { pending, failed, total: pending + failed };
}

/** Texto del banner de ruta, o null si no hay pedidos sin sincronizar. */
export function describePendingOrdersBanner(s: PendingOrdersSummary): string | null {
  if (s.total === 0) return null;
  const parts: string[] = [];
  if (s.pending > 0) parts.push(`${s.pending} pendiente(s) de envío`);
  if (s.failed > 0) parts.push(`${s.failed} con error`);
  return `📦 Pedidos: ${parts.join(' · ')}`;
}

// ── Detalle por ítem (pantalla Sync) ────────────────────────────────────────

export type OrderTone = 'pending' | 'error' | 'sent';

export interface SaleOrderDisplay {
  customerName: string | null;
  total: number | null;
  statusLabel: string;
  tone: OrderTone;
  operationId: string | null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Detalle de un sale_order de la cola para mostrar en Sync. Devuelve null si el
 * item no es sale_order. Lee campos client-only del payload
 * (`_clientCustomerName`, `_clientTotal`) que NO se envían al backend.
 */
export function describeSaleOrderItem(
  item: Pick<SyncQueueItem, 'type' | 'status' | 'payload'> & { id?: string },
): SaleOrderDisplay | null {
  if (item.type !== 'sale_order') return null;
  const payload = (item.payload ?? {}) as Record<string, unknown>;
  let tone: OrderTone;
  let statusLabel: string;
  if (item.status === 'done') { tone = 'sent'; statusLabel = 'Venta enviada'; }
  else if (item.status === 'error' || item.status === 'dead') { tone = 'error'; statusLabel = 'Venta con error'; }
  else { tone = 'pending'; statusLabel = 'Venta pendiente'; }
  return {
    customerName: strOrNull(payload._clientCustomerName),
    total: numOrNull(payload._clientTotal),
    statusLabel,
    tone,
    operationId: strOrNull(payload._operationId) ?? (item.id ?? null),
  };
}

export type StopOrderStatus = 'pending' | 'error';

/**
 * Mapa stopId → estado de su pedido en cola (error gana sobre pending). Solo
 * sale_order pending/syncing/error/dead; ignora done y otros tipos. Para badges
 * por-cliente en la lista de ruta. O(n) sobre la cola, una vez.
 */
export function buildStopOrderStatusMap(
  queue: Array<Pick<SyncQueueItem, 'type' | 'status' | 'payload'>>,
): Record<number, StopOrderStatus> {
  const map: Record<number, StopOrderStatus> = {};
  for (const item of queue) {
    if (item.type !== 'sale_order') continue;
    const stopId = numOrNull((item.payload as Record<string, unknown>)?.stop_id);
    if (stopId == null || stopId <= 0) continue;
    if (item.status === 'error' || item.status === 'dead') {
      map[stopId] = 'error'; // error gana sobre pending
    } else if (item.status === 'pending' || item.status === 'syncing') {
      if (map[stopId] !== 'error') map[stopId] = 'pending';
    }
  }
  return map;
}
