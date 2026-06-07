/**
 * Route KM service — Sprint A captures departure KM (KM inicial).
 * Wraps POST /pwa-ruta/km-update. Arrival KM is Sprint C (cierre).
 * Online-first; throws on functional error.
 */

import { postRest } from './api';
import { logInfo } from '../utils/logger';
import { GFKmResult, KmType } from '../types/routeStart';

const PWA_RUTA = 'pwa-ruta';

function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

export async function updateKm(
  planId: number,
  type: KmType,
  km: number,
): Promise<GFKmResult> {
  // Backend (_handle_km_update) responds with both stored values:
  //   { plan_id, type, departure_km, arrival_km }
  // We surface departure_km/arrival_km so callers can compute KM recorrido
  // even if the local store lost the initial value (Sprint C.1).
  const result = await postRest<unknown>(`${PWA_RUTA}/km-update`, {
    plan_id: planId,
    type,
    km,
  });
  const data = (result && typeof result === 'object'
    ? ((result as Record<string, unknown>).data ?? result)
    : {}) as Record<string, unknown>;
  logInfo('general', 'route_km_update', { planId, type, km });
  return {
    ok: true,
    plan_id: planId,
    type,
    km,
    departure_km: toNum(data.departure_km),
    arrival_km: toNum(data.arrival_km),
  };
}
