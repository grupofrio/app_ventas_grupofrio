/**
 * legacyRefreshRunner — orquestador PURO del refresh autoritativo de inventario
 * pendiente tras migrar eventos legacy refill/unload. RN-free / node-testable.
 *
 * Contrato corregido (Codex): la bandera `legacyRefreshPending` SOLO se limpia
 * DESPUÉS de un `loadProducts` exitoso. Nunca semántica "consume" antes del éxito.
 *   - sin pending           → no hace nada;
 *   - ya hay uno in-flight  → no dispara un segundo (guard);
 *   - sin warehouseId       → conserva pending, reintenta luego;
 *   - loadProducts resuelve → marca completado (limpia la bandera durable);
 *   - loadProducts rechaza  → conserva pending, loggea, permite retry.
 *
 * El guard in-flight vive en el closure del runner: se fija SÍNCRONAMENTE antes
 * del primer await, así dos wakeups simultáneos (red + foreground) producen un
 * único refresh en vuelo.
 */

export type LegacyRefreshOutcome =
  | 'skipped_no_pending'
  | 'skipped_in_flight'
  | 'skipped_no_warehouse'
  | 'refreshed'
  | 'failed';

export interface LegacyRefreshDeps {
  /** Lee (sin consumir) si hay refresh pendiente. */
  hasPending: () => boolean;
  /** warehouseId actual (null si auth/almacén aún no está disponible). */
  getWarehouseId: () => number | null | undefined;
  /** Recarga autoritativa del inventario. Debe rechazar si falla. */
  loadProducts: (warehouseId: number) => Promise<unknown>;
  /** Limpia la bandera pendiente. Solo se invoca tras un refresh EXITOSO. */
  markCompleted: () => void;
  /** Log opcional de fallo (no lanza). */
  onError?: (error: unknown) => void;
}

export interface LegacyRefreshRunner {
  run: () => Promise<LegacyRefreshOutcome>;
  /** Solo para tests/diagnóstico. */
  isInFlight: () => boolean;
}

export function createLegacyRefreshRunner(deps: LegacyRefreshDeps): LegacyRefreshRunner {
  let inFlight = false;

  async function run(): Promise<LegacyRefreshOutcome> {
    if (!deps.hasPending()) return 'skipped_no_pending';
    // Guard in-flight: fijado antes de cualquier await → un solo refresh a la vez.
    if (inFlight) return 'skipped_in_flight';
    const warehouseId = deps.getWarehouseId();
    if (!warehouseId) return 'skipped_no_warehouse'; // conserva pending, reintenta luego

    inFlight = true;
    try {
      await deps.loadProducts(warehouseId);
      deps.markCompleted(); // limpia SOLO tras éxito
      return 'refreshed';
    } catch (error) {
      deps.onError?.(error); // conserva pending para retry en la próxima reconexión/foreground
      return 'failed';
    } finally {
      inFlight = false;
    }
  }

  return { run, isInFlight: () => inFlight };
}
