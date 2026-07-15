import type { GFPlan, PlanState } from '../types/plan';

export interface RouteStartUiState {
  serverStarted: boolean;
  canRequestStart: boolean;
  canContinue: boolean;
}

export function buildRouteStartUiState(input: {
  planState: PlanState | null;
  readyToStart: boolean;
  isOnline: boolean;
}): RouteStartUiState {
  const serverStarted = input.planState === 'in_progress';
  const canRequestStart = input.planState === 'published' && input.readyToStart && input.isOnline;
  return {
    serverStarted,
    canRequestStart,
    canContinue: serverStarted || canRequestStart,
  };
}

export function isCurrentRoutePlan(input: {
  capturedPlanId: number;
  currentPlanId: number | null;
  currentRouteStartPlanId: number | null;
}): boolean {
  return input.currentPlanId === input.capturedPlanId
    && input.currentRouteStartPlanId === input.capturedPlanId;
}

export function isSameStartedRoutePlan(input: {
  capturedPlanId: number;
  currentPlan: Pick<GFPlan, 'plan_id' | 'state'> | null;
  currentRouteStartPlanId: number | null;
}): boolean {
  return input.currentPlan?.plan_id === input.capturedPlanId
    && input.currentPlan.state === 'in_progress'
    && input.currentRouteStartPlanId === input.capturedPlanId;
}
