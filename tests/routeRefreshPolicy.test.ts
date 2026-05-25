import assert from 'node:assert/strict';

interface RouteRefreshPolicyModule {
  shouldKeepCachedStopsAfterEmptyRefresh: (input: {
    cachedPlan: { plan_id?: number | null } | null;
    cachedStops: Array<{ id: number }>;
    nextPlan: { plan_id?: number | null } | null;
    nextStops: Array<{ id: number }>;
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

async function main() {
  const module = await loadModule();
  testKeepsCachedStopsWhenSamePlanRefreshIsEmpty(module);
  testKeepsCachedStopsWhenMyPlanTemporarilyMissing(module);
  testDoesNotKeepCacheForDifferentPlan(module);
  console.log('route refresh policy tests: ok');
}

void main();
