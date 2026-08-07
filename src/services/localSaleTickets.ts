/**
 * Entrada de la proyección de ventas: qué tickets locales cargar para la cola.
 * Helper PURO / RN-free.
 */

import type { SyncQueueItem } from '../types/sync';

/**
 * Ítems `sale_order` de la cola que proyectan tarjeta en Ventas. Un `done`
 * solo proyecta (tarjeta transitoria "Actualizando") si su transición se
 * observó en esta sesión: un done REHIDRATADO de una sesión anterior nunca
 * proyecta — quedaría como tarjeta fantasma permanente si el refresco remoto
 * falla (P1 Codex #62).
 */
export function selectProjectableSaleItems<
  T extends Pick<SyncQueueItem, 'id' | 'type' | 'status'>,
>(queue: T[], sessionCompletedOps: ReadonlySet<string>): T[] {
  return queue.filter((item) => {
    if (item.type !== 'sale_order') return false;
    if (item.status === 'done') return sessionCompletedOps.has(item.id);
    return true;
  });
}

/**
 * IDs de operación de los `sale_order` que proyectan tarjeta, deduplicados en
 * orden de cola. Otros tipos (foto, GPS, visita, pago) nunca cargan tickets.
 * Pasar la cola YA filtrada por selectProjectableSaleItems.
 */
export function collectLocalSaleOperationIds(
  queue: Array<Pick<SyncQueueItem, 'id' | 'type' | 'status'>>,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of queue) {
    if (item.type !== 'sale_order') continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(item.id);
  }
  return ids;
}
