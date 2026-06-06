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

/** A km value is valid when it's a finite non-negative number. */
export function isValidKm(km: unknown): boolean {
  const n = typeof km === 'number' ? km : parseFloat(String(km ?? ''));
  return Number.isFinite(n) && n >= 0;
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
