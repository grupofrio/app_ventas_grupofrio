/**
 * Política pura de refresco de la pestaña Ventas tras cambios en la cola:
 * solo una venta que ALCANZA `done` (transición observada o aparición ya en
 * `done`) justifica pedir sales/summary + sales/list de nuevo. Errores,
 * reintentos y cambios de otros tipos de ítem no refrescan.
 */

export type ObservedSaleStatus = 'pending' | 'syncing' | 'error' | 'dead' | 'done';

export interface SalesQueueTransition {
  /** Estado previo por operation_id, SOLO ítems sale_order. */
  previous: Map<string, ObservedSaleStatus>;
  /** Estado actual por operation_id, SOLO ítems sale_order. */
  current: Map<string, ObservedSaleStatus>;
}

export function shouldRefreshSalesAfterQueueChange(
  transition: SalesQueueTransition,
): boolean {
  for (const [operationId, status] of transition.current) {
    if (status !== 'done') continue;
    if (transition.previous.get(operationId) !== 'done') return true;
  }
  return false;
}
