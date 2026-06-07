/**
 * Operation readiness guard (P0-4 hardening). Pure, testable.
 *
 * Decides whether a vendor is allowed to operate (sell / checkout / consign /
 * close route) based on the start-of-operation sequence:
 *   - plan de ruta activo,
 *   - checklist de unidad completo,
 *   - KM inicial capturado,
 *   - carga aceptada.
 *
 * Reuses the readiness flags already computed by useRouteStartStore
 * (checklist/km/load). This file only composes them with "plan activo" and
 * produces a human message. No network, no RN.
 */

export interface OperationReadinessInput {
  hasActivePlan: boolean;
  checklistDone: boolean;
  kmCaptured: boolean;
  loadAccepted: boolean;
}

export interface OperationReadiness {
  canOperate: boolean;
  missing: string[];
  reason: string | null;
}

export function deriveOperationReadiness(input: OperationReadinessInput): OperationReadiness {
  const missing: string[] = [];
  if (!input.hasActivePlan) missing.push('plan de ruta activo');
  if (!input.checklistDone) missing.push('checklist de unidad');
  if (!input.kmCaptured) missing.push('KM inicial');
  if (!input.loadAccepted) missing.push('aceptar carga');

  const canOperate = missing.length === 0;
  return {
    canOperate,
    missing,
    reason: canOperate
      ? null
      : `Antes de operar, completa en "Iniciar ruta": ${missing.join(', ')}.`,
  };
}
