import type { SyncQueueItem } from '../types/sync';

export type SaleSyncState = {
  status: 'none' | 'pending' | 'done' | 'failed';
  message: string | null;
  // F1.10: 'dead' (reintentos agotados) es un fallo definitivo — el motor de
  // sync ya no lo va a reintentar solo. 'error' puede seguir siendo
  // transitorio (todavía dentro de la ventana de reintento automático).
  // Solo un fallo definitivo habilita la ruta de escape del checkout.
  isDefinitive: boolean;
};

export function getSaleSyncState(
  saleOperationId: string | null,
  queue: Array<Pick<SyncQueueItem, 'id' | 'type' | 'status' | 'error_message'>>,
): SaleSyncState {
  if (!saleOperationId) {
    return { status: 'none', message: null, isDefinitive: false };
  }

  const saleItem = queue.find((item) => item.id === saleOperationId && item.type === 'sale_order');
  if (!saleItem) {
    return { status: 'none', message: null, isDefinitive: false };
  }

  if (saleItem.status === 'done') {
    return { status: 'done', message: null, isDefinitive: false };
  }

  if (saleItem.status === 'dead' || saleItem.status === 'error') {
    return {
      status: 'failed',
      message: saleItem.error_message || 'La venta no se pudo sincronizar.',
      isDefinitive: saleItem.status === 'dead',
    };
  }

  return { status: 'pending', message: null, isDefinitive: false };
}
