/**
 * Perf Fase 2E — decisión pura de cuándo disparar el sync por reconexión.
 *
 * Helper PURO / RN-free (node-testable). `connectivity.ts` debe procesar la cola
 * SOLO en el flanco de subida offline→online (no en cada evento de NetInfo, ni
 * al perder conexión, ni cuando ya estaba online). Esto evita disparos
 * repetidos. La protección contra ciclos concurrentes la da además el guard
 * `if (!isOnline || isSyncing) return` en `useSyncStore.processQueue`.
 */

/** true solo en la transición offline → online (flanco de subida). */
export function shouldProcessOnReconnect(wasOnline: boolean, isNowOnline: boolean): boolean {
  return wasOnline === false && isNowOnline === true;
}
