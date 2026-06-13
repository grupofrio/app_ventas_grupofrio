/**
 * Perf Fase 2C — descripción del estado de datos para el badge de pantallas
 * críticas (ruta, ProductPicker/venta).
 *
 * Helper PURO / RN-free (node-testable). Traduce la metadata de 2B
 * (`fromCache`/`cachedAtMs`) + conectividad en un badge discreto y honesto:
 *   - "Sin conexión"        → offline (con o sin caché)
 *   - "Datos de la mañana"  → usando caché de hace varias horas (preparado AM)
 *   - "Usando caché"        → usando caché reciente
 *   - (oculto)              → online y datos frescos de red (no estorbar)
 *
 * Nunca afirma frescura que no hay: si no se conoce `cachedAtMs`, no inventa la
 * hora. El badge es informativo; no cambia reglas de venta.
 */

export type CacheTone = 'warn' | 'info' | 'ok';

export interface CacheStatusInput {
  fromCache: boolean;
  cachedAtMs: number | null;
  isOnline: boolean;
  nowMs: number;
}

export interface CacheStatus {
  /** Si false, no se muestra badge (online + datos frescos de red). */
  show: boolean;
  label: string;
  /** Línea secundaria ("Actualizado hace X"); null si no se conoce la hora. */
  detail: string | null;
  tone: CacheTone;
}

/** Umbral para considerar el caché "de la mañana" (preparado temprano). */
const MORNING_AGE_MS = 3 * 60 * 60 * 1000;

/** Formatea una antigüedad relativa en español, segura ante valores raros. */
export function formatAgo(cachedAtMs: number | null, nowMs: number): string | null {
  if (cachedAtMs == null || !Number.isFinite(cachedAtMs)) return null;
  const diff = nowMs - cachedAtMs;
  if (!Number.isFinite(diff) || diff < 0) return null;
  if (diff < 60_000) return 'Actualizado hace instantes';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `Actualizado hace ${mins} min`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `Actualizado hace ${hours} h`;
  const days = Math.floor(diff / 86_400_000);
  return `Actualizado hace ${days} día${days === 1 ? '' : 's'}`;
}

export function describeCacheStatus(input: CacheStatusInput): CacheStatus {
  const detail = formatAgo(input.cachedAtMs, input.nowMs);

  if (!input.isOnline) {
    return { show: true, label: 'Sin conexión', detail, tone: 'warn' };
  }

  if (input.fromCache) {
    const age = input.cachedAtMs != null ? input.nowMs - input.cachedAtMs : 0;
    const label = age >= MORNING_AGE_MS ? 'Datos de la mañana' : 'Usando caché';
    return { show: true, label, detail, tone: 'info' };
  }

  // Online y datos frescos de red → no mostrar badge (evita ruido).
  return { show: false, label: '', detail: null, tone: 'ok' };
}
