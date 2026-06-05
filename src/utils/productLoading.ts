export function shouldAutoLoadProducts(
  warehouseId: number | null | undefined,
  productCount: number,
  isLoading: boolean,
  lastSyncMs: number | null = null,
  error: string | null = null,
): boolean {
  return !!warehouseId
    && warehouseId > 0
    && productCount === 0
    && !isLoading
    && !lastSyncMs
    && !error;
}

/**
 * BLD-20260424-LOOP: Cuándo refrescar productos al enfocar una pantalla.
 *
 * El loop reportado en producción (18 requests a /truck_stock en 7 segundos)
 * venía de que esta función NO miraba `productCount` ni `lastSync`. Cada
 * vez que `useFocusEffect` se re-suscribía (porque la callback de
 * `useCallback` cambia al actualizarse `isLoading`), esta función
 * regresaba `true` y disparaba otra carga, que actualizaba `isLoading`,
 * que reconstruía la callback, que re-disparaba el effect. Loop autoalimentado.
 *
 * Reglas nuevas — TODAS deben cumplirse para refrescar:
 *   1. Hay warehouse válido.
 *   2. No hay carga en curso (evita reentrancia).
 *   3. La caché está vacía (productCount === 0)
 *      O ya pasó MIN_REFRESH_INTERVAL_MS desde el último sync.
 *
 * `lastSyncMs` es opcional para mantener compatibilidad con callers
 * que no lo pasan; en ese caso solo aplica el guard de productCount.
 */
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

export function shouldRefreshProductsOnFocus(
  warehouseId: number | null | undefined,
  isLoading: boolean,
  productCount = 0,
  lastSyncMs: number | null = null,
): boolean {
  if (!warehouseId || warehouseId <= 0) return false;
  if (isLoading) return false;
  // Caché vacía → siempre refresca
  if (productCount === 0) return true;
  // Caché poblada → solo refresca si la data ya está rancia
  if (lastSyncMs && Date.now() - lastSyncMs > MIN_REFRESH_INTERVAL_MS) return true;
  // Caché poblada y reciente → no hace nada (evita el loop)
  return false;
}
