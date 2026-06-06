/**
 * Route close service — Sprint C.
 *
 * Only `closeRoute` lives here. The other cierre actions already exist and are
 * REUSED (not duplicated):
 *   - Conciliación:        fetchRouteReconciliation  (gfLogistics.ts, Sebas)
 *   - Validar corte:       validateRouteCorte        (gfLogistics.ts, Sebas)
 *   - Confirmar liquidación: confirmRouteLiquidation (gfLogistics.ts, Sebas)
 *   - KM final:            updateKm('arrival')       (routeKm.ts)
 *
 * close-route is backend-validated: action_close_route() raises if something
 * critical is missing (corte/liquidación per backend rules) and returns
 * warnings. We surface message/warnings; we never simulate success.
 *
 * Endpoint (production, used by PWA): POST /pwa-ruta/close-route
 *   body: { plan_id, departure_km?, arrival_km? }  (backend keeps stored km
 *   when a value is omitted)
 */

import { postRest } from './api';
import { logInfo } from '../utils/logger';

const PWA_RUTA = 'pwa-ruta';

export interface CloseRouteResult {
  ok: boolean;
  message: string;
  state: string;
  km_traveled: number | null;
  warnings: string[];
}

function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

export async function closeRoute(
  planId: number,
  opts: { departureKm?: number | null; arrivalKm?: number | null } = {},
): Promise<CloseRouteResult> {
  const body: Record<string, unknown> = { plan_id: planId };
  if (typeof opts.departureKm === 'number' && opts.departureKm > 0) {
    body.departure_km = opts.departureKm;
  }
  if (typeof opts.arrivalKm === 'number' && opts.arrivalKm > 0) {
    body.arrival_km = opts.arrivalKm;
  }

  // postRest throws on ok:false / HTTP>=400 (envelope detection, fix #16),
  // so a successful return here means the backend accepted the close.
  const result = await postRest<unknown>(`${PWA_RUTA}/close-route`, body);
  const data = (result && typeof result === 'object'
    ? ((result as Record<string, unknown>).data ?? result)
    : {}) as Record<string, unknown>;

  logInfo('general', 'route_close', { planId });

  const warnings = Array.isArray(data.warnings)
    ? data.warnings.filter((w): w is string => typeof w === 'string')
    : [];

  return {
    ok: true,
    message: typeof (result as Record<string, unknown>)?.message === 'string'
      ? (result as Record<string, unknown>).message as string
      : 'Ruta cerrada',
    state: typeof data.state === 'string' ? data.state : 'closed',
    km_traveled: toNum(data.km_traveled),
    warnings,
  };
}
