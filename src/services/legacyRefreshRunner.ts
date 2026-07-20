/**
 * legacyRefreshRunner — orquestador PURO del refresh autoritativo de inventario
 * pendiente tras migrar eventos legacy refill/unload. RN-free / node-testable.
 *
 * Contrato (Codex, ronda final):
 *  - la bandera `legacyRefreshPending` SOLO se limpia tras (a) una carga de
 *    inventario AUTORITATIVA para el warehouse esperado Y (b) la limpieza durable
 *    de la bandera confirmada. Nunca por Promise resuelta ni por `error === null`;
 *  - éxito de carga NO autoritativo (p.ej. `global_legacy`, warehouse distinto) →
 *    conserva pending y reintenta;
 *  - carga autoritativa pero limpieza durable fallida → `completion_persist_failed`,
 *    pending se conserva (retry seguro; a lo sumo repite el refresh);
 *  - guards: sin pending / offline / sin warehouse / ya in-flight;
 *  - guard in-flight fijado SÍNCRONAMENTE antes del primer await → dos wakeups
 *    simultáneos (red + foreground) producen un único refresh.
 */

/** Resultado EXPLÍCITO de una carga de inventario (no inferir éxito por error/null). */
export type InventoryLoadResult =
  | {
      ok: true;
      authoritative: true;
      warehouseId: number;
      source: 'truck_stock' | 'stock_quant';
    }
  | {
      ok: false;
      authoritative: false;
      reason:
        | 'network_error'
        | 'global_legacy_fallback'
        | 'warehouse_mismatch'
        | 'missing_warehouse'
        | 'unknown';
      source?: string;
    };

export type LegacyRefreshOutcome =
  | 'skipped_no_pending'
  | 'skipped_offline'
  | 'skipped_in_flight'
  | 'skipped_no_warehouse'
  | 'skipped_not_authoritative'
  | 'completion_persist_failed'
  | 'refreshed'
  | 'failed';

export interface LegacyRefreshDeps {
  /** LEE (sin consumir) si hay refresh pendiente. */
  hasPending: () => boolean;
  /** Estado de conexión (no reintentar refresh offline). */
  isOnline: () => boolean;
  /** warehouseId actual (null si auth/almacén aún no está disponible). */
  getWarehouseId: () => number | null | undefined;
  /** Carga autoritativa; devuelve resultado tipado (nunca infiere éxito). */
  loadAuthoritative: (warehouseId: number) => Promise<InventoryLoadResult>;
  /**
   * Limpia la bandera pendiente de forma DURABLE (persiste false/elimina la key,
   * espera confirmación, y solo entonces limpia memoria). Debe RECHAZAR si la
   * limpieza durable falla, para que el runner conserve el pending.
   */
  markCompleted: () => Promise<void>;
  /** Log de fallo de carga/limpieza (no lanza). */
  onError?: (error: unknown) => void;
  /** Log de carga no autoritativa (no lanza). */
  onNonAuthoritative?: (result: InventoryLoadResult) => void;
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
    if (!deps.isOnline()) return 'skipped_offline'; // offline: conserva pending
    // Guard in-flight: fijado antes de cualquier await → un solo refresh a la vez.
    if (inFlight) return 'skipped_in_flight';
    const warehouseId = deps.getWarehouseId();
    if (!warehouseId) return 'skipped_no_warehouse'; // conserva pending, reintenta luego

    inFlight = true;
    try {
      let result: InventoryLoadResult;
      try {
        result = await deps.loadAuthoritative(warehouseId);
      } catch (error) {
        deps.onError?.(error);
        return 'failed'; // conserva pending
      }
      // Éxito SOLO si autoritativo para el warehouse esperado (no global_legacy).
      if (!result.ok || !result.authoritative || result.warehouseId !== warehouseId) {
        deps.onNonAuthoritative?.(result);
        return 'skipped_not_authoritative'; // conserva pending
      }
      // Inventario autoritativo cargado → limpieza durable, y solo si esa
      // limpieza confirma se considera 'refreshed'.
      try {
        await deps.markCompleted();
      } catch (error) {
        deps.onError?.(error);
        return 'completion_persist_failed'; // pending se conserva; retry seguro
      }
      return 'refreshed';
    } finally {
      inFlight = false;
    }
  }

  return { run, isInFlight: () => inFlight };
}
