/**
 * Pure helpers for the Sprint A route-start flow. No network, no RN — fully
 * unit-testable.
 *
 * NOTE on load acceptance: KoldField already has load-acceptance logic in
 * `routeLoadAcceptance.ts` (buildRouteLoadAcceptanceState + acceptRouteLoad,
 * shipped by Sebas). Sprint A REUSES that — it does not reimplement the load
 * card parsing here. This file owns checklist progress, KM validation, and
 * readiness composition. Checklist is required for route start, but the gate is
 * based on answers captured, not whether every answer passed.
 */

import type {
  RouteStartReadiness,
  GFVehicleChecklist,
  GFVehicleCheck,
  ChecklistProgress,
} from '../types/routeStart';

/** Compute checklist progress from a header (defensive against missing fields). */
export function computeChecklistProgress(
  header: GFVehicleChecklist | null,
): ChecklistProgress {
  if (!header) return { answered: 0, total: 0, passed: 0, requiredPending: 0 };
  return {
    answered: header.checks_answered,
    total: header.checks_total,
    passed: header.checks_passed,
    requiredPending: header.checks_required_pending,
  };
}

export function isChecklistComplete(header: GFVehicleChecklist | null): boolean {
  return !!header && header.state === 'completed';
}

export function isChecklistAnsweredForStart(header: GFVehicleChecklist | null): boolean {
  if (!header) return false;
  if (isChecklistComplete(header)) return true;
  if (header.checks_total <= 0) return false;
  return header.checks_answered >= header.checks_total;
}

function positiveKm(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function chooseAuthoritativeKm(input: {
  planKm?: number | null;
  backendKm?: number | null;
  localKm?: number | null;
}): number | null {
  return positiveKm(input.planKm) ?? positiveKm(input.backendKm);
}

/**
 * A km value is valid when it's a finite number > 0.
 * Backend (_handle_km_update) rejects km <= 0 ("km debe ser mayor a cero"),
 * so we mirror that client-side to avoid a confusing round-trip rejection.
 */
export function isValidKm(km: unknown): boolean {
  const n = typeof km === 'number' ? km : parseFloat(String(km ?? ''));
  return Number.isFinite(n) && n > 0;
}

function kmOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/**
 * KM recorridos = final - inicial. Returns null when it cannot be computed:
 *   - either value missing / invalid
 *   - final < inicial (would be a negative/incoherent distance)
 * final === inicial → 0 (valid: zero km driven).
 * Sprint C.1.
 */
export function calculateKmDriven(
  initialKm: number | null | undefined,
  finalKm: number | null | undefined,
): number | null {
  const i = kmOrNull(initialKm);
  const f = kmOrNull(finalKm);
  if (i === null || f === null) return null;
  if (f < i) return null;
  return Math.round(f - i);
}

/**
 * P2 — guardas contra valores de KM absurdos (no bloquean: la UI pide
 * confirmación). Criterio documentado:
 *  - Lectura de odómetro > 2,000,000 km: casi siempre es un error de captura
 *    (los vehículos rara vez superan ~1M km). Umbral alto a propósito para no
 *    molestar en operación real.
 *  - Recorrido en un día (final - inicial) > 1,500 km: una ruta de ventas no
 *    recorre esa distancia en un día → probable typo en el KM final.
 * Las reglas duras existentes (km > 0, final >= inicial) NO cambian.
 */
export const MAX_REASONABLE_ODOMETER_KM = 2_000_000;
export const MAX_REASONABLE_KM_PER_DAY = 1_500;

export function isAbsurdOdometer(km: unknown): boolean {
  const n = typeof km === 'number' ? km : parseFloat(String(km ?? ''));
  return Number.isFinite(n) && n > MAX_REASONABLE_ODOMETER_KM;
}

export function isAbsurdKmDriven(driven: number | null | undefined): boolean {
  return typeof driven === 'number' && Number.isFinite(driven) && driven > MAX_REASONABLE_KM_PER_DAY;
}

/** Format a km number with thousands separators: 52428 → "52,428". */
export function formatKm(n: number | null | undefined): string {
  const v = kmOrNull(n);
  if (v === null) return '—';
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Find the numeric "odómetro de salida" check inside a checklist, if present.
 * Used to feed the KM inicial from the checklist instead of asking twice
 * (Sprint A.1, Option A). Heuristic by name + numeric type. Returns the
 * first matching numeric check, or null.
 */
export function findOdometerCheck(checks: GFVehicleCheck[]): GFVehicleCheck | null {
  const ODO = /od[oó]metro|kil[oó]metr|\bkm\b/i;
  for (const c of checks) {
    if (c.check_type === 'numeric' && ODO.test(c.name)) return c;
  }
  return null;
}

/**
 * Extract the captured odometer KM from a checklist's checks, if the
 * odometer numeric check was answered with a value > 0. Returns null
 * otherwise. Used to auto-register KM inicial on checklist completion.
 */
export function extractOdometerKm(checks: GFVehicleCheck[]): number | null {
  const odo = findOdometerCheck(checks);
  if (!odo) return null;
  const v = odo.result_numeric;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  return null;
}

/**
 * Compute overall readiness for "Iniciar ruta".
 * Checklist must be answered, but answers may pass or fail; the purpose is to
 * keep vehicle state current before operating.
 */
export function computeRouteStartReadiness(input: {
  checklistComplete: boolean;
  kmCaptured: boolean;
  loadAccepted: boolean;
}): RouteStartReadiness {
  const { checklistComplete, kmCaptured, loadAccepted } = input;
  return {
    checklistDone: checklistComplete,
    kmCaptured,
    loadAccepted,
    readyToStart: checklistComplete && kmCaptured && loadAccepted,
  };
}
