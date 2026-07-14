import type { GFPlan, PlanState } from '../types/plan';
import { buildInitialLoadAcceptanceState } from './routeLoadAcceptance.ts';

export interface RouteStartPlanSnapshot {
  planId: number;
  planState: PlanState;
  kmInitial: number | null;
  initialLoadAccepted: boolean;
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
