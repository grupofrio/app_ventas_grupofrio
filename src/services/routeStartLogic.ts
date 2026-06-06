/**
 * Pure helpers for the Sprint A route-start flow. No network, no RN — fully
 * unit-testable.
 *
 * NOTE on load acceptance: KoldField already has load-acceptance logic in
 * `routeLoadAcceptance.ts` (buildRouteLoadAcceptanceState + acceptRouteLoad,
 * shipped by Sebas). Sprint A REUSES that — it does not reimplement the load
 * card parsing here. This file only owns checklist progress, KM validation,
 * and overall readiness composition.
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

/**
 * A km value is valid when it's a finite number > 0.
 * Backend (_handle_km_update) rejects km <= 0 ("km debe ser mayor a cero"),
 * so we mirror that client-side to avoid a confusing round-trip rejection.
 */
export function isValidKm(km: unknown): boolean {
  const n = typeof km === 'number' ? km : parseFloat(String(km ?? ''));
  return Number.isFinite(n) && n > 0;
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
 * All three prerequisites must be satisfied.
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
