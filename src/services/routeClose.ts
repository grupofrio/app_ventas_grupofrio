/**
 * Route close service — PREPARED FOR SPRINT C, not wired to any UI yet.
 *
 * Thin wrappers over the cierre-family endpoints so Sprint C (conciliación,
 * validar corte, confirmar liquidación, cerrar ruta) has the contracts ready.
 * KM final reuses updateKm('arrival') from routeKm.ts; reconciliation uses
 * fetchRouteReconciliation (gfLogistics.ts); liquidation summary uses
 * fetchLiquidationSummary (gfLogistics.ts). Those are NOT re-declared here.
 *
 * ⚠️ Do NOT call these from Sprint A/B screens. They mutate route state and
 * belong to the cierre flow. Endpoints (production, used by PWA):
 *   POST /pwa-ruta/validate-corte
 *   POST /gf/logistics/api/employee/liquidacion/confirm
 *   POST /pwa-ruta/close-route
 */

import { postRest } from './api';
import { logInfo } from '../utils/logger';

const PWA_RUTA = 'pwa-ruta';
const GF_BASE = 'gf/logistics/api/employee';

export interface ValidateCorteResult {
  ok: boolean;
  raw: unknown;
}

/** Recalcula y persiste validación de corte. (Sprint C) */
export async function validateCorte(
  planId: number,
  clientValidation: Record<string, unknown> = {},
  notes = '',
): Promise<ValidateCorteResult> {
  const raw = await postRest<unknown>(`${PWA_RUTA}/validate-corte`, {
    plan_id: planId,
    client_validation: clientValidation,
    notes: notes.trim(),
  });
  logInfo('general', 'route_validate_corte', { planId });
  return { ok: true, raw };
}

/** Confirma la liquidación (endpoint canónico gf_logistics_ops). (Sprint C) */
export async function confirmLiquidacion(
  planId: number,
  opts: { notes?: string; force?: boolean; cashCollected?: number | null } = {},
): Promise<{ ok: boolean; raw: unknown }> {
  const body: Record<string, unknown> = {
    plan_id: planId,
    notes: (opts.notes ?? '').trim(),
    force: !!opts.force,
  };
  if (typeof opts.cashCollected === 'number') body.cash_collected = opts.cashCollected;
  const raw = await postRest<unknown>(`${GF_BASE}/liquidacion/confirm`, body);
  logInfo('general', 'route_confirm_liquidacion', { planId });
  return { ok: true, raw };
}

/** Cierra la ruta con KM de salida/llegada. (Sprint C) */
export async function closeRoute(
  planId: number,
  departureKm: number,
  arrivalKm: number,
): Promise<{ ok: boolean; raw: unknown }> {
  const raw = await postRest<unknown>(`${PWA_RUTA}/close-route`, {
    plan_id: planId,
    departure_km: departureKm,
    arrival_km: arrivalKm,
  });
  logInfo('general', 'route_close', { planId });
  return { ok: true, raw };
}
