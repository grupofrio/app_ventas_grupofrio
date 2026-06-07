import assert from 'node:assert/strict';

interface RouteRefreshPolicyModule {
  shouldKeepCachedStopsAfterEmptyRefresh: (input: {
    cachedPlan: { plan_id?: number | null } | null;
    cachedStops: Array<{ id: number }>;
    nextPlan: { plan_id?: number | null } | null;
    nextStops: Array<{ id: number }>;
  }) => boolean;
  ROUTE_CACHE_TTL_MS: number;
  routePlanVersionToken: (plan: {
    plan_id?: number | null;
    route_plan_version?: string | null;
    demand_snapshot_hash?: string | null;
    write_date?: string | null;
    route_plan_write_date?: string | null;
    state?: string | null;
  } | null) => string;
  shouldRefreshRouteCache: (input: {
    plan: { route_plan_cache_ttl_seconds?: number | null } | null;
    lastSync: number | null;
    now: number;
    isOnline: boolean;
    force?: boolean;
  }) => boolean;
  routeFreshnessStatus: (input: {
    plan: { route_plan_cache_ttl_seconds?: number | null } | null;
    lastSync: number | null;
    now: number;
    isOnline: boolean;
  }) => 'updated' | 'stale' | 'offline_cache';
  shouldReloadRouteStops: (input: {
    cachedStopsCount: number;
    cachedToken: string;
    nextToken: string;
  }) => boolean;
}

async function loadModule(): Promise<RouteRefreshPolicyModule> {
  // @ts-ignore -- Node runs this ESM test harness directly.
  return await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/routeRefreshPolicy.ts', import.meta.url).pathname
  ) as RouteRefreshPolicyModule;
}

function testKeepsCachedStopsWhenSamePlanRefreshIsEmpty(module: RouteRefreshPolicyModule) {
  assert.equal(
    module.shouldKeepCachedStopsAfterEmptyRefresh({
      cachedPlan: { plan_id: 42 },
      cachedStops: [{ id: 1 }, { id: 2 }],
      nextPlan: { plan_id: 42 },
      nextStops: [],
    }),
    true,
  );
}

function testKeepsCachedStopsWhenMyPlanTemporarilyMissing(module: RouteRefreshPolicyModule) {
  assert.equal(
    module.shouldKeepCachedStopsAfterEmptyRefresh({
      cachedPlan: { plan_id: 42 },
      cachedStops: [{ id: 1 }],
      nextPlan: null,
      nextStops: [],
    }),
    true,
  );
}

function testDoesNotKeepCacheForDifferentPlan(module: RouteRefreshPolicyModule) {
  assert.equal(
    module.shouldKeepCachedStopsAfterEmptyRefresh({
      cachedPlan: { plan_id: 42 },
      cachedStops: [{ id: 1 }],
      nextPlan: { plan_id: 99 },
      nextStops: [],
    }),
    false,
  );
}

function testRoutePlanVersionTokenPrefersBackendToken(module: RouteRefreshPolicyModule) {
  assert.equal(
    module.routePlanVersionToken({
      plan_id: 42,
      route_plan_version: 'server-token',
      demand_snapshot_hash: 'hash-a',
      write_date: '2026-06-05 12:00:00',
      state: 'published',
    }),
    'server-token',
  );
}

function testRoutePlanVersionTokenFallsBackToStableFields(module: RouteRefreshPolicyModule) {
  assert.equal(
    module.routePlanVersionToken({
      plan_id: 42,
      demand_snapshot_hash: 'hash-a',
      write_date: '2026-06-05 12:00:00',
      state: 'published',
    }),
    '42|2026-06-05 12:00:00|published|hash-a',
  );
}

function testRouteCacheRefreshesAfterTtl(module: RouteRefreshPolicyModule) {
  const now = Date.UTC(2026, 5, 5, 12, 15, 1);
  assert.equal(
    module.shouldRefreshRouteCache({
      plan: { route_plan_cache_ttl_seconds: 900 },
      lastSync: Date.UTC(2026, 5, 5, 12, 0, 0),
      now,
      isOnline: true,
    }),
    true,
  );
  assert.equal(
    module.shouldRefreshRouteCache({
      plan: { route_plan_cache_ttl_seconds: 900 },
      lastSync: Date.UTC(2026, 5, 5, 12, 5, 0),
      now,
      isOnline: true,
    }),
    false,
  );
}

function testRouteCacheDoesNotRefreshOfflineUnlessForced(module: RouteRefreshPolicyModule) {
  assert.equal(
    module.shouldRefreshRouteCache({
      plan: { route_plan_cache_ttl_seconds: 900 },
      lastSync: Date.UTC(2026, 5, 5, 12, 0, 0),
      now: Date.UTC(2026, 5, 5, 12, 30, 0),
      isOnline: false,
    }),
    false,
  );
  assert.equal(
    module.shouldRefreshRouteCache({
      plan: { route_plan_cache_ttl_seconds: 900 },
      lastSync: Date.UTC(2026, 5, 5, 12, 0, 0),
      now: Date.UTC(2026, 5, 5, 12, 1, 0),
      isOnline: false,
      force: true,
    }),
    false,
  );
}

function testRouteFreshnessStatus(module: RouteRefreshPolicyModule) {
  assert.equal(
    module.routeFreshnessStatus({
      plan: { route_plan_cache_ttl_seconds: 900 },
      lastSync: Date.UTC(2026, 5, 5, 12, 0, 0),
      now: Date.UTC(2026, 5, 5, 12, 1, 0),
      isOnline: true,
    }),
    'updated',
  );
  assert.equal(
    module.routeFreshnessStatus({
      plan: { route_plan_cache_ttl_seconds: 900 },
      lastSync: Date.UTC(2026, 5, 5, 12, 0, 0),
      now: Date.UTC(2026, 5, 5, 12, 30, 0),
      isOnline: true,
    }),
    'stale',
  );
  assert.equal(
    module.routeFreshnessStatus({
      plan: { route_plan_cache_ttl_seconds: 900 },
      lastSync: Date.UTC(2026, 5, 5, 12, 0, 0),
      now: Date.UTC(2026, 5, 5, 12, 30, 0),
      isOnline: false,
    }),
    'offline_cache',
  );
}

function testReloadsStopsOnlyWhenTokenChanges(module: RouteRefreshPolicyModule) {
  assert.equal(
    module.shouldReloadRouteStops({
      cachedStopsCount: 31,
      cachedToken: '42|2026-06-05 12:00:00|published|hash-a',
      nextToken: '42|2026-06-05 12:00:00|published|hash-a',
    }),
    false,
  );
  assert.equal(
    module.shouldReloadRouteStops({
      cachedStopsCount: 31,
      cachedToken: '42|2026-06-05 12:00:00|published|hash-a',
      nextToken: '42|2026-06-05 12:10:00|published|hash-b',
    }),
    true,
  );
  assert.equal(
    module.shouldReloadRouteStops({
      cachedStopsCount: 0,
      cachedToken: '42|2026-06-05 12:00:00|published|hash-a',
      nextToken: '42|2026-06-05 12:00:00|published|hash-a',
    }),
    true,
  );
}

async function main() {
  const module = await loadModule();
  testKeepsCachedStopsWhenSamePlanRefreshIsEmpty(module);
  testKeepsCachedStopsWhenMyPlanTemporarilyMissing(module);
  testDoesNotKeepCacheForDifferentPlan(module);
  testRoutePlanVersionTokenPrefersBackendToken(module);
  testRoutePlanVersionTokenFallsBackToStableFields(module);
  testRouteCacheRefreshesAfterTtl(module);
  testRouteCacheDoesNotRefreshOfflineUnlessForced(module);
  testRouteFreshnessStatus(module);
  testReloadsStopsOnlyWhenTokenChanges(module);
  console.log('route refresh policy tests: ok');
}

void main();
