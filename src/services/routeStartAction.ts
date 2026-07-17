import type { StartPlanResult } from './gfLogistics';
import type { PlanState } from '../types/plan';

interface RefreshedRoutePlan {
  plan_id: number;
  state: PlanState;
}

export interface ConfirmAuthoritativeRouteStartInput {
  planId: number;
  currentState: PlanState | null;
  start: (planId: number) => Promise<StartPlanResult>;
  refresh: () => Promise<RefreshedRoutePlan | null>;
  markStarted: () => void;
}

const confirmedStart = (planId: number): StartPlanResult => ({
  planId,
  state: 'in_progress',
});

export async function confirmAuthoritativeRouteStart({
  planId,
  currentState,
  start,
  refresh,
  markStarted,
}: ConfirmAuthoritativeRouteStartInput): Promise<StartPlanResult> {
  if (currentState === 'in_progress') {
    markStarted();
    return confirmedStart(planId);
  }

  let result: StartPlanResult;
  try {
    result = await start(planId);
  } catch (startError) {
    let refreshed: RefreshedRoutePlan | null = null;
    try {
      refreshed = await refresh();
    } catch {
      // Preserve the original mutation error when reconciliation is unavailable.
    }

    if (refreshed?.plan_id === planId && refreshed.state === 'in_progress') {
      markStarted();
      return confirmedStart(planId);
    }

    throw startError;
  }

  markStarted();
  try {
    await refresh();
  } catch {
    // The validated mutation response is authoritative; refresh is best effort.
  }
  return result;
}
