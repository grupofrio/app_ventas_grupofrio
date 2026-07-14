import type { GFPlan, PlanState } from '../types/plan';
import { buildInitialLoadAcceptanceState } from './routeLoadAcceptance.ts';

export interface RouteStartPlanSnapshot {
  planId: number;
  planState: PlanState;
  kmInitial: number | null;
  initialLoadAccepted: boolean;
}

export interface RouteStartPersistedFacts {
  planId: number | null;
  checklistComplete: boolean;
  kmInitial: number | null;
  loadAccepted: boolean;
}

function positiveKm(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function deriveRouteStartPlanSnapshot(plan: GFPlan): RouteStartPlanSnapshot {
  return {
    planId: Number(plan.plan_id),
    planState: plan.state,
    kmInitial: positiveKm(plan.departure_km),
    initialLoadAccepted: buildInitialLoadAcceptanceState(plan).initialLoadAccepted,
  };
}

export function mergeRouteStartPlanSnapshot(
  current: RouteStartPersistedFacts,
  snapshot: RouteStartPlanSnapshot,
): RouteStartPersistedFacts {
  return {
    planId: snapshot.planId,
    checklistComplete: current.planId === snapshot.planId
      ? current.checklistComplete
      : false,
    kmInitial: snapshot.kmInitial,
    loadAccepted: snapshot.initialLoadAccepted,
  };
}
