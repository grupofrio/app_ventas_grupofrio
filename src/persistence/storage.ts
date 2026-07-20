/**
 * Typed persistence layer — AsyncStorage wrapper.
 *
 * ARCHITECTURE DECISION (F6):
 * V1 uses AsyncStorage (no native build required, works with Expo Go).
 * V2 can swap to WatermelonDB by implementing the same interface.
 *
 * All stores use this layer instead of AsyncStorage directly.
 * Data is JSON-serialized with type safety.
 *
 * Storage keys are namespaced: "kf:{entity}:{subkey}"
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'kf:';

// ═══════════════════════════════════════════
// CORE OPERATIONS
// ═══════════════════════════════════════════

export async function storeSave<T>(key: string, data: T): Promise<void> {
  try {
    const serialized = JSON.stringify(data);
    await AsyncStorage.setItem(`${PREFIX}${key}`, serialized);
  } catch (error) {
    console.error(`[storage] save failed for ${key}:`, error);
  }
}

export async function storeLoad<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${key}`);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`[storage] load failed for ${key}:`, error);
    return null;
  }
}

export async function storeRemove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${PREFIX}${key}`);
  } catch (error) {
    console.error(`[storage] remove failed for ${key}:`, error);
  }
}

// ── Variantes ESTRICTAS (rechazan en fallo) ──────────────────────────────────
// Los `store*` normales absorben el error (log + resolve) para no romper flujos
// tolerantes. Para transiciones CRÍTICAS (durabilidad de reparaciones pendientes)
// se necesita observar el fallo y abortar; estas variantes propagan la excepción.

export async function storeSaveStrict<T>(key: string, data: T): Promise<void> {
  const serialized = JSON.stringify(data);
  await AsyncStorage.setItem(`${PREFIX}${key}`, serialized);
}

export async function storeRemoveStrict(key: string): Promise<void> {
  await AsyncStorage.removeItem(`${PREFIX}${key}`);
}

export async function storeClear(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const kfKeys = allKeys.filter((k) => k.startsWith(PREFIX));
    if (kfKeys.length > 0) {
      await AsyncStorage.multiRemove(kfKeys);
    }
  } catch (error) {
    console.error('[storage] clear failed:', error);
  }
}

// ═══════════════════════════════════════════
// TYPED ENTITY HELPERS
// ═══════════════════════════════════════════

/** Save an array of entities with a namespace */
export async function storeEntities<T>(entity: string, data: T[]): Promise<void> {
  await storeSave(`entities:${entity}`, data);
}

/** Load entities */
export async function loadEntities<T>(entity: string): Promise<T[]> {
  const data = await storeLoad<T[]>(`entities:${entity}`);
  return data || [];
}

// ═══════════════════════════════════════════
// STORAGE KEYS (centralized)
// ═══════════════════════════════════════════

export const STORAGE_KEYS = {
  // Auth
  AUTH_STATE: 'auth:state',

  // Route
  PLAN: 'route:plan',
  STOPS: 'route:stops',
  VISIT_STATE: 'visit:active',
  ROUTE_START: 'route:start', // Sprint A: checklist/km/load readiness cache

  // Products
  PRODUCTS: 'entities:products',
  // Perf Fase 2B: catálogo persistente de jornada (sobrevive reinicios) +
  // dump del caché de precios por cliente. Solo LECTURA offline; la venta
  // sigue online-first y el backend valida stock/precio al confirmar.
  PRODUCTS_CATALOG: 'cache:products:catalog',
  PRICES_CACHE: 'cache:prices',
  // Perf Fase 2D-1: consignaciones activas cacheadas SOLO para lectura offline.
  // create/visit/close siguen online-first; backend = fuente de verdad.
  CONSIGNMENTS: 'cache:consignments',

  // KOLD intelligence
  KOLD_SCORES: 'kold:scores',
  KOLD_FORECASTS: 'kold:forecasts',

  // Sync queue
  SYNC_QUEUE: 'sync:queue',
  // Marca DURABLE de refresh autoritativo de inventario pendiente tras migrar
  // eventos legacy refill/unload. Debe sobrevivir cierres de app y errores de
  // red hasta lograr un loadProducts exitoso (entonces se limpia).
  LEGACY_REFRESH_PENDING: 'sync:legacyRefreshPending',

  // Timestamps
  LAST_FULL_SYNC: 'meta:lastFullSync',
} as const;
