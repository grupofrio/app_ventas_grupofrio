/**
 * Perf Fase 2D-1 — caché de LECTURA de consignaciones activas.
 *
 * Permite que, sin red, el vendedor vea la consignación activa de un cliente
 * (folio, líneas, objetivo/existencia/precio, última visita) como **lectura
 * cacheada**. NUNCA habilita crear/visitar/cerrar offline: esas mutaciones
 * siguen online-first y el backend es la fuente de verdad (inventario, cobro,
 * resurtido, devolución, cierre).
 *
 * Diseño (igual que 2B):
 *   - helpers PUROS (RN-free, node-testables) para contexto/selección/upsert;
 *   - wiring de disco aislado (AsyncStorage) usando el sobre versionado de
 *     `persistentCache` (schemaVersion + contextKey de jornada + TTL).
 *
 * Estrategia de llenado (degradación documentada): el endpoint `my-active` es
 * POR CLIENTE; precargar N en la preparación duplicaría RPCs y la mayoría de
 * clientes no tiene consignación. Por eso 2D-1 cachea **al primer acceso
 * online** a la pantalla del cliente (read-through), no en bloque. La precarga
 * masiva queda para 2D-2 si el backend expone un endpoint batch (ver doc 2A).
 */

import { buildCacheEnvelope, readCacheEnvelope } from './persistentCache';
import { storeSave, storeLoad, storeRemove, STORAGE_KEYS } from '../persistence/storage';
import { getCacheContext, type CacheContext } from './offlineCache';
import type { ActiveConsignment } from '../types/consignment';
import {
  CONSIGNMENT_CACHE_TTL_MS,
  buildConsignmentsContextKey,
  selectConsignment,
  upsertConsignment,
  type ConsignmentCachePayload,
} from './consignmentCacheLogic';
import { logInfo, logWarn } from '../utils/logger';

// Re-export de los helpers puros para que los consumidores (pantalla) importen
// todo desde un solo módulo.
export {
  CONSIGNMENT_CACHE_TTL_MS,
  buildConsignmentsContextKey,
  selectConsignment,
  upsertConsignment,
  canMutateConsignment,
} from './consignmentCacheLogic';
export type { ConsignmentCachePayload } from './consignmentCacheLogic';

// ── Wiring de disco (AsyncStorage) ──────────────────────────────────────────

async function loadPayloadEnvelope(
  ctx: CacheContext,
): Promise<{ payload: ConsignmentCachePayload; cachedAtMs: number | null } | null> {
  const raw = await storeLoad<unknown>(STORAGE_KEYS.CONSIGNMENTS);
  if (raw === null) return null;
  const result = readCacheEnvelope<ConsignmentCachePayload>(
    raw,
    buildConsignmentsContextKey(ctx),
    CONSIGNMENT_CACHE_TTL_MS,
    Date.now(),
  );
  if (result.status !== 'ok' || !result.payload) {
    // miss (otro día/usuario/empresa/corrupto) o stale → limpiar, no usar.
    await storeRemove(STORAGE_KEYS.CONSIGNMENTS);
    if (result.status === 'stale') logInfo('general', 'consignment_cache_stale_cleared', {});
    return null;
  }
  return { payload: result.payload, cachedAtMs: result.cachedAtMs };
}

/** Lee la consignación cacheada de un cliente (null si miss/stale/corrupto). */
export async function readCachedConsignment(
  partnerId: number,
  ctx: CacheContext = getCacheContext(),
): Promise<{ consignment: ActiveConsignment; cachedAtMs: number | null } | null> {
  try {
    const env = await loadPayloadEnvelope(ctx);
    if (!env) return null;
    const consignment = selectConsignment(env.payload, partnerId);
    if (!consignment) return null;
    return { consignment, cachedAtMs: env.cachedAtMs };
  } catch (error) {
    logWarn('general', 'consignment_cache_read_failed', { error: String(error) });
    return null;
  }
}

/**
 * Escribe (read-through) la consignación de un cliente tras una lectura online
 * exitosa. `consignment` null elimina la entrada (cliente quedó sin activa).
 */
export async function writeCachedConsignment(
  partnerId: number,
  consignment: ActiveConsignment | null,
  ctx: CacheContext = getCacheContext(),
): Promise<void> {
  if (!ctx.employeeId) return; // sin sesión no hay jornada a la que asociar
  try {
    const env = await loadPayloadEnvelope(ctx);
    const nextPayload = upsertConsignment(env?.payload ?? {}, partnerId, consignment);
    const envelope = buildCacheEnvelope(
      nextPayload,
      buildConsignmentsContextKey(ctx),
      Date.now(),
    );
    await storeSave(STORAGE_KEYS.CONSIGNMENTS, envelope);
  } catch (error) {
    logWarn('general', 'consignment_cache_write_failed', { error: String(error) });
  }
}

/** Limpia el caché persistente de consignaciones (p.ej. al cerrar ruta — 2E). */
export async function clearCachedConsignments(): Promise<void> {
  try { await storeRemove(STORAGE_KEYS.CONSIGNMENTS); } catch { /* noop */ }
}
