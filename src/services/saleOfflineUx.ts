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

export interface SaleRecoveryNotice {
  show: boolean;
  message: string;
}

export function describeSaleRecoveryNotice(input: {
  saleConfirmed: boolean;
  saleRecoveryPersistenceFailed: boolean;
  hasRecoveryIntent: boolean;
}): SaleRecoveryNotice {
  if (!input.saleConfirmed || !input.saleRecoveryPersistenceFailed) {
    return { show: false, message: '' };
  }

  if (input.hasRecoveryIntent) {
    return {
      show: true,
      message: 'No pudimos completar la recuperación local. Reinicia la app y sincroniza; si continúa bloqueado, contacta a soporte.',
    };
  }

  return {
    show: true,
    message: 'El resultado de este pedido no puede verificarse automáticamente. No intentes otra venta; solicita una revisión manual a soporte.',
  };
}

/**
 * Etiqueta del botón de confirmación según el estado del pedido. Una falla de
 * recuperación se muestra primero; en los demás casos, prioriza el estado real
 * de sincronización para no rotular como confirmado un pedido aún pendiente.
 */
export function saleConfirmButtonLabel(input: {
  saleSyncStatus: SaleSyncStatusLike;
  isOnline: boolean;
  saleConfirmed: boolean;
  saleRecoveryPersistenceFailed?: boolean;
  hasRecoveryIntent?: boolean;
}): string {
  if (input.saleConfirmed && input.saleRecoveryPersistenceFailed) {
    return input.hasRecoveryIntent
      ? '⚠️ Recuperación pendiente'
      : '⚠️ Revisión requerida';
  }

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
