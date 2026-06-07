type PlanIdentity = {
  plan_id?: number | null;
};

type PlanCacheIdentity = PlanIdentity & {
  state?: string | null;
  route_plan_version?: string | null;
  write_date?: string | null;
  route_plan_write_date?: string | null;
  demand_snapshot_hash?: string | null;
  route_plan_cache_ttl_seconds?: number | null;
};

type StopIdentity = {
  id: number;
};

export const ROUTE_CACHE_TTL_MS = 15 * 60 * 1000;

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

export function routePlanVersionToken(plan: PlanCacheIdentity | null): string {
  if (!plan) return '';
  const backendToken = String(plan.route_plan_version ?? '').trim();
  if (backendToken) return backendToken;
  const writeDate = plan.write_date ?? plan.route_plan_write_date ?? '';
  return [
    plan.plan_id ?? '',
    writeDate,
    plan.state ?? '',
    plan.demand_snapshot_hash ?? '',
  ].join('|');
}

function ttlMsFromPlan(plan: PlanCacheIdentity | null): number {
  const ttlSeconds = Number(plan?.route_plan_cache_ttl_seconds ?? 0);
  return ttlSeconds > 0 ? ttlSeconds * 1000 : ROUTE_CACHE_TTL_MS;
}

export function shouldRefreshRouteCache(input: {
  plan: PlanCacheIdentity | null;
  lastSync: number | null;
  now: number;
  isOnline: boolean;
  force?: boolean;
}): boolean {
  if (!input.isOnline) return false;
  if (input.force) return true;
  if (!input.plan || !input.lastSync) return true;
  return input.now - input.lastSync > ttlMsFromPlan(input.plan);
}

export function routeFreshnessStatus(input: {
  plan: PlanCacheIdentity | null;
  lastSync: number | null;
  now: number;
  isOnline: boolean;
}): 'updated' | 'stale' | 'offline_cache' {
  if (!input.isOnline) return 'offline_cache';
  return shouldRefreshRouteCache(input) ? 'stale' : 'updated';
}

export function shouldReloadRouteStops(input: {
  cachedStopsCount: number;
  cachedToken: string;
  nextToken: string;
}): boolean {
  if (input.cachedStopsCount <= 0) return true;
  if (!input.cachedToken || !input.nextToken) return true;
  return input.cachedToken !== input.nextToken;
}
