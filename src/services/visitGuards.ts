import type { StopState } from '../types/plan';
import type { VisitPhase } from '../stores/useVisitStore';

const COMPLETED_STOP_STATES: StopState[] = [
  'done',
  'not_visited',
  'no_stock',
  'rejected',
  'closed',
];

const ACTIVE_VISIT_PHASES: VisitPhase[] = ['checked_in', 'selling', 'no_selling'];

interface DeriveVisitGuardInput {
  stopState: StopState;
  stopId: number;
  currentStopId: number | null;
  phase: VisitPhase;
  currentStopExists?: boolean;
}

export function isCompletedStopState(stopState: StopState): boolean {
  return COMPLETED_STOP_STATES.includes(stopState);
}

export function isVisitPhaseActive(phase: VisitPhase): boolean {
  return ACTIVE_VISIT_PHASES.includes(phase);
}

export function deriveVisitGuard({
  stopState,
  stopId,
  currentStopId,
  phase,
  currentStopExists = true,
}: DeriveVisitGuardInput) {
  const visitPhaseActive = isVisitPhaseActive(phase);
  const hasValidActiveVisit = visitPhaseActive && currentStopExists && currentStopId !== null;
  const isCurrentVisit = hasValidActiveVisit && currentStopId === stopId;
  const hasAnotherActiveVisit = hasValidActiveVisit && currentStopId !== stopId;
  const isCompletedStop = isCompletedStopState(stopState);
  const canStartVisit = stopState === 'pending' && !hasAnotherActiveVisit;

  // BLD-20260426: Allow resuming an "orphaned" in_progress visit.
  // This handles the case where the visit store lost its state (app kill,
  // failed rehydration, navigation) but the stop is still in_progress on
  // the backend. Without this, the user is deadlocked — can't resume and
  // can't start a new visit on this stop.
  const canResumeVisit = stopState === 'in_progress' && isCurrentVisit;
  const canResumeOrphanedVisit =
    stopState === 'in_progress' && !isCurrentVisit && !hasAnotherActiveVisit;
  const canResume = canResumeVisit || canResumeOrphanedVisit;
  const canAccessVisitActions = canResume;

  let visitActionBlockReason: string | null = null;
  if (!canAccessVisitActions) {
    if (isCompletedStop) {
      visitActionBlockReason = 'La visita ya terminó. Venta y regalo quedan bloqueados.';
    } else if (hasAnotherActiveVisit) {
      visitActionBlockReason = 'Otra visita está en curso. Termina esa visita antes de registrar un regalo.';
    } else {
      visitActionBlockReason = 'Haz check-in para registrar un regalo.';
    }
  }

  let primaryActionLabel = '📍 Check-in · Iniciar Visita';

  if (isCompletedStop) {
    primaryActionLabel = stopState === 'done' ? '✓ Visita completada' : '⛔ Parada cerrada';
  } else if (canResume) {
    primaryActionLabel = '▶ Continuar Visita';
  } else if (hasAnotherActiveVisit) {
    primaryActionLabel = '🔒 Otra visita en curso';
  }

  return {
    isCompletedStop,
    isCurrentVisit,
    hasAnotherActiveVisit,
    canStartVisit,
    canResumeVisit: canResume,
    canAccessVisitActions,
    visitActionBlockReason,
    primaryActionLabel,
  };
}
