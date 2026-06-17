/**
 * Copy consistente para el comportamiento offline de flujos secundarios
 * (BLD-20260617-SECONDARY-OFFLINE). Helpers PUROS / RN-free (node-testables).
 *
 * Regla de oro: NUNCA decir "registrado/confirmado" si la operación solo quedó
 * local/encolada. Si un flujo no puede operar offline de forma segura, el copy
 * explica POR QUÉ requiere conexión.
 */

export interface OfflineCopy {
  title: string;
  body: string;
}

/**
 * Refill (solicitud de carga): SE ENCOLA siempre (sale_order-like, idempotente
 * por operation_id) — no toca inventario al capturar. Mensaje honesto: quedó
 * GUARDADA para enviar, NO "registrada" (Odoo confirma al sincronizar).
 */
export function refillSavedMessage(): OfflineCopy {
  return {
    title: 'Solicitud guardada',
    body: 'Se enviará a tu almacén al sincronizar. Puedes verla en Sincronización.',
  };
}

/**
 * Consignación: BLOQUEA offline (create/visit/close mutan inventario de la
 * camioneta —resurtido/cobro/devolución— y necesitan folio + conciliación en
 * tiempo real; no hay modelo local idempotente). Copy explica el porqué.
 */
export function consignmentOfflineBlockMessage(): OfflineCopy {
  return {
    title: 'Sin conexión',
    body: 'La consignación requiere conexión para mantener el inventario trazable.',
  };
}

/**
 * Preventa: BLOQUEA offline (la cotización sale.order se genera en Odoo en el
 * momento y devuelve folio; además la búsqueda de cliente es en línea). Copy
 * honesto: no se guarda local, requiere conexión.
 */
export function presaleOfflineBlockMessage(): OfflineCopy {
  return {
    title: 'Sin conexión',
    body: 'Conéctate para registrar la preventa: la cotización se genera en Odoo en el momento.',
  };
}

/**
 * Acción tras un rechazo insufficient_stock: el carrito se conserva, la venta
 * NO se confirmó. Indica qué hacer.
 */
export function insufficientStockActionHint(): string {
  return 'Se actualizó el inventario. Ajusta la cantidad o elimina el producto agotado e intenta de nuevo. Tu pedido NO se ha confirmado.';
}

// ── Etiqueta de Sync por ítem ────────────────────────────────────────────────
//
// El refill se encola como `prospection` (tipo compartido con nuevo-cliente,
// descarga, post-visita), así que el tipo no basta para etiquetarlo. Se
// distingue por su payload (model 'van.refill.request' / type 'refill') SIN
// tocar dispatcher ni payload.

export function isRefillSyncItem(item: {
  type?: string;
  payload?: Record<string, unknown> | null;
}): boolean {
  if (item.type !== 'prospection') return false;
  const p = item.payload ?? {};
  return p.model === 'van.refill.request' || p.type === 'refill';
}

/** Etiqueta a mostrar en Sync: específica para refill, si no el fallback. */
export function syncItemLabel(
  item: { type?: string; payload?: Record<string, unknown> | null },
  fallbackLabel: string,
): string {
  if (isRefillSyncItem(item)) return 'Solicitud de carga';
  return fallbackLabel;
}
