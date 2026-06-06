/**
 * Route KM service — Sprint A captures departure KM (KM inicial).
 * Wraps POST /pwa-ruta/km-update. Arrival KM is Sprint C (cierre).
 * Online-first; throws on functional error.
 */

import { postRest } from './api';
import { logInfo } from '../utils/logger';
import { GFKmResult, KmType } from '../types/routeStart';

const PWA_RUTA = 'pwa-ruta';

export async function updateKm(
  planId: number,
  type: KmType,
  km: number,
): Promise<GFKmResult> {
  await postRest<unknown>(`${PWA_RUTA}/km-update`, {
    plan_id: planId,
    type,
    km,
  });
  logInfo('general', 'route_km_update', { planId, type, km });
  return { ok: true, plan_id: planId, type, km };
}
