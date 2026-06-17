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
