/**
 * Typed persistence layer.
 *
 * ARCHITECTURE DECISION (F6):
 * Harmless preferences use AsyncStorage. Employee-scoped operational data uses
 * the native encrypted session envelope selected by fieldDataPersistenceLogic.
 *
 * Storage keys are namespaced: "kf:{entity}:{subkey}"
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ENCRYPTED_FIELD_DATA_KEYS,
  isEncryptedFieldDataKey,
} from '../services/fieldDataPersistenceLogic.ts';
import { getFieldDataSession } from '../services/fieldDataSession.ts';

const PREFIX = 'kf:';

function plaintextKey(key: string): string {
  return `${PREFIX}${key}`;
}

async function removeLegacyPlaintextFieldData(key: string): Promise<void> {
  // Migration is erase-only: a legacy plaintext value is never copied into the
  // encrypted envelope because it cannot be trusted to match this session.
  await AsyncStorage.removeItem(plaintextKey(key));
}

/**
 * Removes the bounded set of pre-encryption operational keys on logout or an
 * account switch. This is intentionally erase-only: no old plaintext record
 * can be associated with the next authenticated employee session.
 */
export async function clearSensitiveFieldData(): Promise<void> {
  await AsyncStorage.multiRemove(ENCRYPTED_FIELD_DATA_KEYS.map(plaintextKey));
}

async function saveFieldData<T>(key: string, data: T): Promise<void> {
  await removeLegacyPlaintextFieldData(key);
  const session = await getFieldDataSession();
  if (!session) throw new Error(`Encrypted field-data session unavailable for ${key}`);
  const { saveEncrypted } = await import('../services/encryptedStore.ts');
  await saveEncrypted(session, key, data);
}

async function loadFieldData<T>(key: string): Promise<T | null> {
  await removeLegacyPlaintextFieldData(key);
  const session = await getFieldDataSession();
  if (!session) return null;
  const { loadEncrypted } = await import('../services/encryptedStore.ts');
  return loadEncrypted<T>(session, key);
}

async function removeFieldData(key: string): Promise<void> {
  await removeLegacyPlaintextFieldData(key);
  const session = await getFieldDataSession();
  if (session) {
    const { removeEncrypted } = await import('../services/encryptedStore.ts');
    await removeEncrypted(session, key);
  }
}

// ═══════════════════════════════════════════
// CORE OPERATIONS
// ═══════════════════════════════════════════

export async function storeSave<T>(key: string, data: T): Promise<void> {
  try {
    if (isEncryptedFieldDataKey(key)) {
      await saveFieldData(key, data);
      return;
    }
    const serialized = JSON.stringify(data);
    await AsyncStorage.setItem(plaintextKey(key), serialized);
  } catch (error) {
    console.error(`[storage] save failed for ${key}:`, error);
  }
}

export async function storeLoad<T>(key: string): Promise<T | null> {
  try {
    if (isEncryptedFieldDataKey(key)) return loadFieldData<T>(key);
    const raw = await AsyncStorage.getItem(plaintextKey(key));
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`[storage] load failed for ${key}:`, error);
    return null;
  }
}

export async function storeRemove(key: string): Promise<void> {
  try {
    if (isEncryptedFieldDataKey(key)) {
      await removeFieldData(key);
      return;
    }
    await AsyncStorage.removeItem(plaintextKey(key));
  } catch (error) {
    console.error(`[storage] remove failed for ${key}:`, error);
  }
}

// ── Variantes ESTRICTAS (rechazan en fallo) ──────────────────────────────────
// Los `store*` normales absorben el error (log + resolve) para no romper flujos
// tolerantes. Para transiciones CRÍTICAS (durabilidad de reparaciones pendientes)
// se necesita observar el fallo y abortar; estas variantes propagan la excepción.

export async function storeSaveStrict<T>(key: string, data: T): Promise<void> {
  if (isEncryptedFieldDataKey(key)) {
    await saveFieldData(key, data);
    return;
  }
  const serialized = JSON.stringify(data);
  await AsyncStorage.setItem(plaintextKey(key), serialized);
}

export async function storeLoadStrict<T>(key: string): Promise<T | null> {
  if (isEncryptedFieldDataKey(key)) {
    return loadFieldData<T>(key);
  }
  const raw = await AsyncStorage.getItem(plaintextKey(key));
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null) {
    throw new Error(`[storage] strict load rejected persisted null for ${key}`);
  }
  return parsed as T;
}

export async function storeRemoveStrict(key: string): Promise<void> {
  if (isEncryptedFieldDataKey(key)) {
    await removeFieldData(key);
    return;
  }
  await AsyncStorage.removeItem(plaintextKey(key));
}

export async function storeClear(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const kfKeys = allKeys.filter((k) => k.startsWith(PREFIX));
    if (kfKeys.length > 0) {
      await AsyncStorage.multiRemove(kfKeys);
    }
    const session = await getFieldDataSession();
    if (session) {
      const { clearEncryptedSession } = await import('../services/encryptedStore.ts');
      await clearEncryptedSession(session);
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
  ROUTE_PREPARATION: 'route:preparation', // Durable receipt for "Preparar ruta"

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

  // Preferences
  THERMAL_PRINTER: 'preferences:thermalPrinter',

  // Timestamps
  LAST_FULL_SYNC: 'meta:lastFullSync',
} as const;
