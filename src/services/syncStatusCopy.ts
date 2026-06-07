/**
 * Sync queue status copy (P1). Pure, testable.
 *
 * Convierte los contadores de la cola en un estado claro para el vendedor:
 * sincronizado / sincronizando / pendiente / con error. Centraliza el copy para
 * usarlo en pantallas (sync, banners) sin tocar la lógica de la cola.
 */

export type SyncTone = 'ok' | 'syncing' | 'pending' | 'error';

export interface SyncQueueState {
  pendingCount: number;
  errorCount: number;
  deadCount: number;
  isSyncing: boolean;
  isOnline?: boolean;
}

export interface SyncStatusCopy {
  tone: SyncTone;
  label: string;
  detail: string;
}

/**
 * Prioridad: error/dead (lo más grave) > sincronizando > pendiente > ok.
 * Los items error/dead son ventas/pagos que NO llegaron al backend y por eso
 * bloquean el cierre/liquidación (ver cashcloseGuard).
 */
export function describeSyncQueueState(s: SyncQueueState): SyncStatusCopy {
  const failed = (s.errorCount || 0) + (s.deadCount || 0);
  if (failed > 0) {
    return {
      tone: 'error',
      label: `${failed} con error`,
      detail: 'Hay operaciones que no se sincronizaron. Resuélvelas antes de cerrar/liquidar.',
    };
  }
  if (s.isSyncing) {
    return { tone: 'syncing', label: 'Sincronizando…', detail: 'Enviando operaciones al servidor.' };
  }
  if ((s.pendingCount || 0) > 0) {
    return {
      tone: 'pending',
      label: `${s.pendingCount} pendientes`,
      detail: s.isOnline === false
        ? 'Sin conexión. Se enviarán al reconectar.'
        : 'Pendientes por sincronizar.',
    };
  }
  return { tone: 'ok', label: 'Todo sincronizado', detail: 'No hay operaciones pendientes.' };
}

/** Bloqueo de cierre/liquidación por estado de cola (mensaje claro). */
export function describeCloseBlockReason(s: SyncQueueState): string | null {
  const failed = (s.errorCount || 0) + (s.deadCount || 0);
  if (failed > 0) return `Hay ${failed} operación(es) con error sin sincronizar.`;
  if ((s.pendingCount || 0) > 0) return `Hay ${s.pendingCount} operación(es) pendientes por sincronizar.`;
  if (s.isSyncing) return 'Sincronizando…';
  return null;
}
