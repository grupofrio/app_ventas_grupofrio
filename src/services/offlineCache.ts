/**
 * Perf Fase 2B — wiring de caché persistente de jornada (AsyncStorage).
 *
 * Junta tres piezas que por separado son puras/aisladas:
 *   - `persistentCache.ts`  → sobre versionado + validación (puro).
 *   - `pricelistCache.ts`   → serialize/hydrate de los Maps de precios (puro).
 *   - `storage.ts`          → AsyncStorage namespaced.
 *
 * Responsabilidad de este módulo: el caché de **precios** (catálogo de
 * productos lo maneja `useProductStore` directamente para evitar ciclos de
 * import). También expone el contexto de jornada compartido y un persist
 * debounced (mismo patrón que `useSyncStore.schedulePersist`).
 *
 * Regla Fase 2 (no negociable): caché = SOLO LECTURA offline. La venta sigue
 * online-first; el backend es la fuente final de verdad de stock/precio al
 * confirmar. Persistir precios NO habilita venta offline: el ProductPicker los
 * usa para mostrar, y la venta revalida contra backend.
 */

import { storeSave, storeLoad, storeRemove, STORAGE_KEYS } from '../persistence/storage';
import {
  buildCacheEnvelope,
  readCacheEnvelope,
  buildContextKey,
} from './persistentCache';
import {
  serializePriceCache,
  hydratePriceCache,
  CUSTOMER_PRICE_CACHE_TTL_MS,
} from './pricelistCache';
import { useAuthStore } from '../stores/useAuthStore';
import { useRouteStore } from '../stores/useRouteStore';
import { todayLocalISO } from '../utils/localDate';
import { logInfo, logWarn } from '../utils/logger';

/**
 * TTL del sobre persistente de precios. Holgado (cubre una jornada larga); el
 * TTL real por-entrada lo sigue gobernando `CUSTOMER_PRICE_CACHE_TTL_MS` al
 * leer. La invalidación primaria es la contextKey (cambio de día/usuario).
 */
export const PRICES_ENVELOPE_TTL_MS = Math.max(CUSTOMER_PRICE_CACHE_TTL_MS, 14 * 60 * 60 * 1000);

const PERSIST_PRICES_DEBOUNCE_MS = 1500;
let _persistPricesTimer: ReturnType<typeof setTimeout> | null = null;

export interface CacheContext {
  dayKey: string;
  employeeId: number | null;
  companyId: number | null;
  warehouseId: number | null;
  planId: number | null;
}

/** Snapshot del contexto de jornada actual desde auth + route. */
export function getCacheContext(): CacheContext {
  const auth = useAuthStore.getState();
  const plan = useRouteStore.getState().plan;
  return {
    dayKey: todayLocalISO(),
    employeeId: auth.employeeId,
    companyId: auth.companyId,
    warehouseId: auth.warehouseId,
    planId: plan?.plan_id ?? null,
  };
}

/**
 * contextKey para PRECIOS: día + empleado + empresa. No incluye almacén/plan
 * porque los precios son por cliente y estables entre planes del mismo día;
 * un cambio de día o de vendedor sí debe invalidar.
 */
export function buildPricesContextKey(ctx: CacheContext): string {
  return buildContextKey([ctx.dayKey, ctx.employeeId, ctx.companyId]);
}

/** Persiste inmediatamente el caché de precios en memoria → disco. */
export async function persistPriceCacheNow(ctx: CacheContext = getCacheContext()): Promise<void> {
  // Sin sesión no hay jornada a la que asociar el caché.
  if (!ctx.employeeId) return;
  try {
    const serialized = serializePriceCache();
    if (serialized.prices.length === 0 && serialized.pricelistIds.length === 0) return;
    const envelope = buildCacheEnvelope(serialized, buildPricesContextKey(ctx), Date.now());
    await storeSave(STORAGE_KEYS.PRICES_CACHE, envelope);
  } catch (error) {
    logWarn('general', 'price_cache_persist_failed', { error: String(error) });
  }
}

/**
 * Persist debounced (trailing) — se llama tras computar/cachear precios
 * (preparación de ruta, refresh de catálogo, picker). Evita escribir en disco
 * en cada cómputo individual.
 */
export function schedulePersistPriceCache(): void {
  if (_persistPricesTimer) clearTimeout(_persistPricesTimer);
  _persistPricesTimer = setTimeout(() => {
    _persistPricesTimer = null;
    void persistPriceCacheNow();
  }, PERSIST_PRICES_DEBOUNCE_MS);
}

/**
 * Rehidrata el caché de precios desde disco en boot. Valida contexto/TTL del
 * sobre; si no coincide (otro día/usuario) o está corrupto/vencido, limpia la
 * entrada y no hidrata. Devuelve cuántas entradas de precio se restauraron.
 */
export async function hydratePriceCacheFromDisk(ctx: CacheContext = getCacheContext()): Promise<number> {
  try {
    const raw = await storeLoad<unknown>(STORAGE_KEYS.PRICES_CACHE);
    if (raw === null) return 0;
    const result = readCacheEnvelope<ReturnType<typeof serializePriceCache>>(
      raw,
      buildPricesContextKey(ctx),
      PRICES_ENVELOPE_TTL_MS,
      Date.now(),
    );
    if (result.status !== 'ok' || !result.payload) {
      // miss (otro contexto/corrupto/versión) o stale → limpiar y no hidratar.
      await storeRemove(STORAGE_KEYS.PRICES_CACHE);
      if (result.status === 'stale') {
        logInfo('general', 'price_cache_stale_cleared', {});
      }
      return 0;
    }
    const restored = hydratePriceCache(result.payload, Date.now());
    logInfo('general', 'price_cache_hydrated', { restored });
    return restored;
  } catch (error) {
    logWarn('general', 'price_cache_hydrate_failed', { error: String(error) });
    try { await storeRemove(STORAGE_KEYS.PRICES_CACHE); } catch { /* noop */ }
    return 0;
  }
}

/** Limpia el caché persistente de precios en disco (p.ej. al cerrar ruta). */
export async function clearPersistedPriceCache(): Promise<void> {
  try { await storeRemove(STORAGE_KEYS.PRICES_CACHE); } catch { /* noop */ }
}

/** Limpia el catálogo persistente en disco (p.ej. al cerrar ruta — Fase 2E). */
export async function clearPersistedCatalog(): Promise<void> {
  try { await storeRemove(STORAGE_KEYS.PRODUCTS_CATALOG); } catch { /* noop */ }
}
