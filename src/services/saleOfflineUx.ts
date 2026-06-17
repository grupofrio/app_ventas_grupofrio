/**
 * UX de venta sin conexión. Helper PURO / RN-free.
 *
 * Modelo "pedido offline pendiente de envío" (S1): sin señal el vendedor PUEDE
 * guardar el pedido; se encola como `sale_order` y se envía a Odoo al reconectar.
 * NUNCA se marca como venta confirmada offline ni se crea pago/stock definitivo
 * local (eso ocurre al sincronizar, cuando Odoo acepta). El cierre/liquidación
 * quedan bloqueados mientras haya pedidos pendientes/error en la cola.
 */

export interface SaleOfflineUx {
  showBanner: boolean;
  bannerText: string;
  /** Texto bajo el botón cuando no hay conexión (pre-guardado). */
  buttonHint: string | null;
}

export function describeSaleOfflineUx(isOnline: boolean): SaleOfflineUx {
  if (isOnline) {
    return { showBanner: false, bannerText: '', buttonHint: null };
  }
  return {
    showBanner: true,
    bannerText: 'Sin conexión: puedes guardar el pedido como pendiente; se enviará a Odoo al reconectar y no queda confirmado hasta entonces.',
    buttonHint: 'El pedido se enviará a Odoo cuando vuelva la conexión.',
  };
}

export type SaleSyncStatusLike = 'none' | 'pending' | 'done' | 'failed';

/**
 * Etiqueta del botón de confirmación según el estado del pedido. Prioriza el
 * estado real de sincronización (pedido offline encolado) sobre el lock local,
 * para que el vendedor nunca vea "confirmado" un pedido que sigue pendiente.
 */
export function saleConfirmButtonLabel(input: {
  saleSyncStatus: SaleSyncStatusLike;
  isOnline: boolean;
  saleConfirmed: boolean;
}): string {
  switch (input.saleSyncStatus) {
    case 'pending':
      return '⏳ Pedido pendiente de envío';
    case 'failed':
      return '⚠️ Error al enviar (revisa Sync)';
    case 'done':
      return '✓ Pedido enviado';
    default:
      break;
  }
  if (input.saleConfirmed) return '✓ Pedido confirmado';
  if (!input.isOnline) return '💾 Guardar pedido pendiente';
  return '✓ Confirmar Pedido';
}
