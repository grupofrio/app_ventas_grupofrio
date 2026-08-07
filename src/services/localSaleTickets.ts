/**
 * Entrada de la proyección de ventas: qué tickets locales cargar para la cola.
 * Helper PURO / RN-free.
 */

import type { SyncQueueItem } from '../types/sync';

/**
 * IDs de operación de los `sale_order` de la cola que aún proyectan tarjeta
 * (incluye `done` transitorio para la tarjeta "Actualizando"), deduplicados en
 * orden de cola. Otros tipos (foto, GPS, visita, pago) nunca cargan tickets.
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
