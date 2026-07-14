/**
 * Operation readiness guard. Odoo's plan state is authoritative: local
 * route-start facts only help explain what is missing before a published plan
 * is started, and can never revoke an in-progress server plan.
 */

import type { PlanState } from '../types/plan';

export type OperationMode = 'transaction' | 'close';

export interface OperationReadinessInput {
  planState: PlanState | null;
  planMatchesReadiness: boolean;
  checklistDone: boolean;
  kmCaptured: boolean;
  loadAccepted: boolean;
  mode?: OperationMode;
}

export interface OperationReadiness {
  canOperate: boolean;
  missing: string[];
  warnings: string[];
  reason: string | null;
}

function allowed(): OperationReadiness {
  return {
    canOperate: true,
    missing: [],
    warnings: [],
    reason: null,
  };
}

function blocked(missing: string[], reason: string): OperationReadiness {
  return {
    canOperate: false,
    missing,
    warnings: [],
    reason,
  };
}

export function deriveOperationReadiness(input: OperationReadinessInput): OperationReadiness {
  const mode = input.mode ?? 'transaction';

  switch (input.planState) {
    case null:
      return blocked(
        ['plan de ruta activo'],
        'No hay un plan de ruta activo. Actualiza la ruta antes de operar.',
      );

    case 'draft':
      return blocked(
        ['publicar plan de ruta'],
        'El plan de ruta está en borrador. Debe publicarse antes de iniciar la ruta.',
      );

    case 'confirmed':
      return blocked(
        ['publicar plan de ruta'],
        'El plan de ruta está confirmado, pero todavía debe publicarse antes de iniciar la ruta.',
      );

    case 'published': {
      const factsMatchPlan = input.planMatchesReadiness;
      const missing: string[] = [];
      if (!factsMatchPlan || !input.checklistDone) missing.push('checklist de unidad');
      if (!factsMatchPlan || !input.kmCaptured) missing.push('KM inicial');
      if (!factsMatchPlan || !input.loadAccepted) missing.push('aceptar carga');

      if (missing.length > 0) {
        return blocked(
          missing,
          `Antes de operar, completa en "Iniciar ruta": ${missing.join(', ')}.`,
        );
      }

      return blocked(
        ['confirmar inicio de ruta'],
        'Confirma "Iniciar ruta" y espera a que el servidor registre el inicio.',
      );
    }

    case 'in_progress':
      return allowed();

    case 'closed':
      return mode === 'close'
        ? allowed()
        : blocked(['ruta en progreso'], 'La ruta ya está cerrada; no admite nuevas operaciones.');

    case 'reconciled':
      return mode === 'close'
        ? allowed()
        : blocked(['ruta en progreso'], 'La ruta ya está conciliada; no admite nuevas operaciones.');

    case 'done':
      return mode === 'close'
        ? allowed()
        : blocked(['ruta en progreso'], 'La ruta ya está finalizada; no admite nuevas operaciones.');

    default: {
      const exhaustiveState: never = input.planState;
      return exhaustiveState;
    }
  }
}
