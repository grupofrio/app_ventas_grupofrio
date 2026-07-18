import type { GFStop } from '../types/plan';

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export interface PlanStopsExtraction {
  /** true SOLO si el backend mandó un ARRAY real de stops (aunque esté vacío). */
  found: boolean;
  stops: unknown[];
}

/**
 * Extrae el array de stops de una respuesta EXITOSA de /plan/stops, soportando
 * las formas conocidas: array pelado, `{ data: { stops: [] } }`, `{ data: [] }`,
 * o `{ stops: [] }` al tope.
 *
 * P2 (Codex): `found:false` = respuesta exitosa pero SIN array de stops válido
 * (data vacío/null, shape inesperado, sin `stops`). El caller NO debe tratar
 * eso como `ok + []` (ruta vacía real) — es un error de forma. Una ruta vacía
 * REAL solo existe cuando el backend manda explícitamente un array (aunque []).
 */
export function extractPlanStopsArray(result: unknown): PlanStopsExtraction {
  if (Array.isArray(result)) return { found: true, stops: result };
  if (!result || typeof result !== 'object') return { found: false, stops: [] };

  const record = result as Record<string, unknown>;
  const hasData = Object.prototype.hasOwnProperty.call(record, 'data');
  const data = hasData ? record.data : record;

  if (
    data && typeof data === 'object' && !Array.isArray(data) &&
    Array.isArray((data as Record<string, unknown>).stops)
  ) {
    return { found: true, stops: (data as Record<string, unknown>).stops as unknown[] };
  }
  if (Array.isArray(data)) return { found: true, stops: data };
  return { found: false, stops: [] };
}

export function normalizePlanStopPayload(raw: Record<string, unknown>): GFStop {
  const stop = { ...raw } as unknown as GFStop;
  const pricelistId = asPositiveNumber(raw.pricelist_id);
  const pricelistName = asNonEmptyString(raw.pricelist_name);

  return {
    ...stop,
    _pricelistId: stop._pricelistId ?? pricelistId,
    _pricelistName: stop._pricelistName ?? pricelistName,
  };
}
