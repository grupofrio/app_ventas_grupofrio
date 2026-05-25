type PlanIdentity = {
  plan_id?: number | null;
};

type StopIdentity = {
  id: number;
};

export function shouldKeepCachedStopsAfterEmptyRefresh(input: {
  cachedPlan: PlanIdentity | null;
  cachedStops: StopIdentity[];
  nextPlan: PlanIdentity | null;
  nextStops: StopIdentity[];
}): boolean {
  if (!input.cachedPlan || input.cachedStops.length === 0 || input.nextStops.length > 0) {
    return false;
  }

  if (!input.nextPlan) {
    return true;
  }

  return input.cachedPlan.plan_id === input.nextPlan.plan_id;
}
