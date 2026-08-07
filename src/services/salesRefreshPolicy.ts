/**
 * Política pura de refresco de la pestaña Ventas tras cambios en la cola:
 * solo una venta cuya TRANSICIÓN a `done` fue observada en esta sesión
 * (estado previo conocido y distinto de done) justifica pedir
 * sales/summary + sales/list de nuevo. Un `done` que aparece sin estado
 * previo es un ítem REHIDRATADO de una sesión anterior: no refresca ni
 * proyecta tarjeta (el escritor de persistencia filtra done, pero el
 * rehydrate no — un blob viejo puede resucitarlos). Errores, reintentos y
 * cambios de otros tipos de ítem no refrescan.
 */

export type ObservedSaleStatus = 'pending' | 'syncing' | 'error' | 'dead' | 'done';

export interface SalesQueueTransition {
  /** Estado previo por operation_id, SOLO ítems sale_order. */
  previous: Map<string, ObservedSaleStatus>;
  /** Estado actual por operation_id, SOLO ítems sale_order. */
  current: Map<string, ObservedSaleStatus>;
}

function isObservedCompletion(
  transition: SalesQueueTransition,
  operationId: string,
  status: ObservedSaleStatus,
): boolean {
  if (status !== 'done') return false;
  const previousStatus = transition.previous.get(operationId);
  return previousStatus !== undefined && previousStatus !== 'done';
}

export function shouldRefreshSalesAfterQueueChange(
  transition: SalesQueueTransition,
): boolean {
  for (const [operationId, status] of transition.current) {
    if (isObservedCompletion(transition, operationId, status)) return true;
  }
  return false;
}

/**
 * Acumula las operaciones cuya llegada a `done` se observó EN ESTA SESIÓN.
 * Solo esas proyectan la tarjeta transitoria "Actualizando"; un done
 * rehidratado nunca entra. Poda las que ya no están en la cola. Devuelve el
 * mismo Set si nada cambió (estabilidad referencial para React).
 */
export function collectSessionCompletedSales(
  transition: SalesQueueTransition,
  known: ReadonlySet<string>,
): ReadonlySet<string> {
  const next = new Set<string>();
  for (const operationId of known) {
    if (transition.current.has(operationId)) next.add(operationId);
  }
  for (const [operationId, status] of transition.current) {
    if (isObservedCompletion(transition, operationId, status)) next.add(operationId);
  }
  if (next.size === known.size && [...next].every((id) => known.has(id))) {
    return known;
  }
  return next;
}
