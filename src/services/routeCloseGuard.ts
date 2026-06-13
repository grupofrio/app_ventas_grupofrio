/**
 * Perf Fase 2E — gate de cierre de ruta por sincronización pendiente.
 *
 * Helper PURO / RN-free (node-testable). El cierre de ruta NO debe ocurrir
 * mientras haya operaciones críticas sin sincronizar (ventas/cobros/etc. en la
 * cola): cerrar con pendientes deja efectivo/inventario fantasma y un corte que
 * no cuadra. Reusa la misma idea que `cashcloseGuard` (pending/error/dead +
 * isSyncing) pero enfocada al botón "Cerrar ruta" de `route-close`.
 *
 * NO bloquea por lecturas cacheadas (catálogo/precios/consignación): el caché
 * de lectura no es trabajo pendiente de sincronizar.
 */

export interface SyncCloseInput {
  pendingCount: number;
  errorCount: number;
  deadCount: number;
  isSyncing: boolean;
}

/** Operaciones en la cola que representan trabajo sin confirmar en backend. */
export function unsyncedCount(input: SyncCloseInput): number {
  return (input.pendingCount ?? 0) + (input.errorCount ?? 0) + (input.deadCount ?? 0);
}

/** Hay trabajo sin sincronizar (cola con items) o un ciclo de sync en curso. */
export function hasUnsyncedWork(input: SyncCloseInput): boolean {
  return unsyncedCount(input) > 0 || input.isSyncing === true;
}

/** Permite cerrar la ruta solo cuando la cola está limpia y no hay sync activo. */
export function canCloseRoute(input: SyncCloseInput): boolean {
  return !hasUnsyncedWork(input);
}

/**
 * Mensaje claro de por qué el cierre está bloqueado, o null si se permite.
 * Encabezado fijo pedido por el flujo + detalle de conteos.
 */
export function describeCloseSyncBlock(input: SyncCloseInput): string | null {
  if (input.isSyncing) {
    return 'Sincronizando operaciones… espera a que termine antes de cerrar ruta.';
  }
  const pending = input.pendingCount ?? 0;
  const failed = (input.errorCount ?? 0) + (input.deadCount ?? 0);
  if (pending + failed === 0) return null;
  const parts: string[] = [];
  if (pending > 0) parts.push(`${pending} pendiente(s)`);
  if (failed > 0) parts.push(`${failed} con error`);
  return `Sincroniza operaciones pendientes antes de cerrar ruta (${parts.join(', ')}).`;
}

/**
 * Limpieza del caché de jornada SOLO tras un cierre exitoso. Pura y trivial,
 * pero deja explícito (y testeable) el invariante: si el cierre falla, NO se
 * limpia nada (los datos siguen disponibles para reintentar/auditar).
 */
export function shouldCleanupJornadaCache(closeSucceeded: boolean): boolean {
  return closeSucceeded === true;
}
