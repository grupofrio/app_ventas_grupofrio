/**
 * Operation readiness guard (P0-4 hardening). Pure, testable.
 *
 * Decides whether a vendor is allowed to operate (sell / checkout / consign /
 * close route) based on the hard start-of-operation prerequisites:
 *   - plan de ruta activo,
 *   - checklist de unidad respondido,
 *   - KM inicial capturado,
 *   - carga aceptada.
 *
 * Checklist validation is about captured answers, not pass/fail outcome. A jefe
 * de ruta can report any real vehicle condition, but must answer before
 * operating.
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
  warnings: string[];
  reason: string | null;
}

export function deriveOperationReadiness(input: OperationReadinessInput): OperationReadiness {
  const missing: string[] = [];
  const warnings: string[] = [];
  if (!input.hasActivePlan) missing.push('plan de ruta activo');
  if (!input.checklistDone) missing.push('checklist de unidad');
  if (!input.kmCaptured) missing.push('KM inicial');
  if (!input.loadAccepted) missing.push('aceptar carga');

  const canOperate = missing.length === 0;
  return {
    canOperate,
    missing,
    warnings,
    reason: canOperate
      ? null
      : `Antes de operar, completa en "Iniciar ruta": ${missing.join(', ')}.`,
  };
}
