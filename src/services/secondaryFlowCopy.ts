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
 * Consignación: offline create/visit/close via durable sync queue + ledger
 * (POST-R1C). Same operation_id on retry; Backend gf_consignment is idempotent.
 */
export function consignmentOfflineBlockMessage(): OfflineCopy {
  return {
    title: 'Sin conexión',
    body: 'La consignación se guardó localmente y se sincronizará al recuperar señal.',
  };
}

/**
 * Copy when an offline consignación was captured (not yet server-confirmed).
 */
export function consignmentPendingSyncMessage(): OfflineCopy {
  return {
    title: 'Consignación pendiente',
    body: 'Quedó guardada en el dispositivo. Se enviará al recuperar conexión. Puedes continuar la ruta.',
  };
}

/**
 * Preventa: cotización draft sin inventario. Offline se permite cuando el
 * cliente ya está seleccionado (p.ej. desde check-in). La búsqueda de
 * cliente sigue requiriendo red.
 */
export function presaleOfflineBlockMessage(): OfflineCopy {
  return {
    title: 'Sin conexión',
    body: 'Para buscar un cliente nuevo necesitas conexión. Si ya tienes cliente y productos, puedes guardar la preventa para sincronizar.',
  };
}

/** Confirmación honesta: encolada, no folio Odoo todavía. */
export function presaleQueuedMessage(): OfflineCopy {
  return {
    title: 'Preventa pendiente',
    body: 'La preventa quedó guardada y se sincronizará al reconectar. Aún no hay folio de cotización en Odoo.',
  };
}

/**
 * Acción tras un rechazo insufficient_stock: el carrito se conserva, la venta
 * NO se confirmó. Indica qué hacer.
 */
export function insufficientStockActionHint(): string {
  return 'Se actualizó el inventario. Ajusta la cantidad o elimina el producto agotado e intenta de nuevo. Tu pedido NO se ha confirmado.';
}
