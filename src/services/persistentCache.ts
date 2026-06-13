/**
 * Perf Fase 2B — sobre (envelope) puro para caché persistente de jornada.
 *
 * RN-free / sin efectos: solo construye y valida sobres. El wiring a disco
 * (AsyncStorage) vive en `offlineCache.ts` y en los stores; esta capa es la
 * que se prueba en el node test runner.
 *
 * Un sobre envuelve cualquier payload con metadatos para invalidación segura:
 *   - schemaVersion: si cambia el formato, se bumpea la constante y todo el
 *     caché viejo se trata como miss (no se lee una estructura incompatible).
 *   - contextKey: identidad de jornada (día/usuario/empresa/…); si no coincide
 *     con el contexto actual, el caché es de otra ruta/día/vendedor → miss.
 *   - cachedAtMs: para TTL de jornada.
 *
 * Regla de Fase 2: el caché es SOLO LECTURA offline. Nunca autoriza venta; el
 * backend valida stock/precio al confirmar. Este módulo no conoce esa regla,
 * pero la preserva por construcción (solo serializa/valida datos de lectura).
 */

/**
 * Versión del formato de sobre + payloads cacheados. Bump = invalida todo el
 * caché persistente anterior de forma segura (se trata como cache miss).
 */
export const CACHE_SCHEMA_VERSION = 1;

export interface CacheEnvelope<T> {
  schemaVersion: number;
  cachedAtMs: number;
  contextKey: string;
  payload: T;
}

export type CacheReadStatus = 'ok' | 'stale' | 'miss';

export interface CacheReadResult<T> {
  status: CacheReadStatus;
  payload: T | null;
  cachedAtMs: number | null;
}

/**
 * Construye una contextKey determinista a partir de las partes relevantes de
 * la jornada (día, empleado, empresa y opcionalmente almacén/plan). Orden fijo
 * y valores normalizados para que la misma jornada produzca siempre la misma
 * clave. `null`/`undefined` se serializan como `-` para no colisionar con 0.
 */
export function buildContextKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((p) => {
      if (p === null || p === undefined) return '-';
      return String(p);
    })
    .join('|');
}

/** Envuelve un payload en un sobre versionado con contexto y timestamp. */
export function buildCacheEnvelope<T>(
  payload: T,
  contextKey: string,
  nowMs: number,
): CacheEnvelope<T> {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    cachedAtMs: nowMs,
    contextKey,
    payload,
  };
}

function isEnvelopeShape(raw: unknown): raw is CacheEnvelope<unknown> {
  if (!raw || typeof raw !== 'object') return false;
  const env = raw as Record<string, unknown>;
  return (
    typeof env.schemaVersion === 'number' &&
    typeof env.cachedAtMs === 'number' &&
    typeof env.contextKey === 'string' &&
    'payload' in env
  );
}

/**
 * Lee y valida un sobre crudo (típicamente el resultado de `JSON.parse` de
 * AsyncStorage). Devuelve:
 *   - `miss`  → no usar: nulo, malformado, versión distinta, o contexto distinto
 *               (otro día/usuario/ruta). El caller debe limpiar la entrada.
 *   - `stale` → el contexto coincide pero venció el TTL de jornada. El payload
 *               se devuelve por si el caller quiere fallback marcado, pero la
 *               política de 2B es limpiarlo y recargar al volver online.
 *   - `ok`    → válido y fresco; usar el payload.
 *
 * Nunca lanza: cualquier forma inesperada cae a `miss`.
 */
export function readCacheEnvelope<T>(
  raw: unknown,
  contextKey: string,
  ttlMs: number,
  nowMs: number,
): CacheReadResult<T> {
  if (!isEnvelopeShape(raw)) {
    return { status: 'miss', payload: null, cachedAtMs: null };
  }
  if (raw.schemaVersion !== CACHE_SCHEMA_VERSION) {
    return { status: 'miss', payload: null, cachedAtMs: null };
  }
  if (raw.contextKey !== contextKey) {
    return { status: 'miss', payload: null, cachedAtMs: null };
  }
  const ageMs = nowMs - raw.cachedAtMs;
  if (!Number.isFinite(ageMs) || ageMs > ttlMs) {
    return { status: 'stale', payload: raw.payload as T, cachedAtMs: raw.cachedAtMs };
  }
  return { status: 'ok', payload: raw.payload as T, cachedAtMs: raw.cachedAtMs };
}
