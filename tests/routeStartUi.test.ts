import assert from 'node:assert/strict';

interface RouteStartUiModule {
  buildRouteStartUiState: (input: {
    planState: string | null;
    readyToStart: boolean;
    isOnline: boolean;
  }) => {
    serverStarted: boolean;
    canRequestStart: boolean;
    canContinue: boolean;
  };
  isSameStartedRoutePlan: (input: {
    capturedPlanId: number;
    currentPlan: { plan_id: number; state: string } | null;
    currentRouteStartPlanId: number | null;
  }) => boolean;
  isCurrentRoutePlan: (input: {
    capturedPlanId: number;
    currentPlanId: number | null;
    currentRouteStartPlanId: number | null;
  }) => boolean;
}

async function main() {
  const module = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/routeStartUi.ts', import.meta.url).pathname
  ) as RouteStartUiModule;

  assert.deepEqual(
    module.buildRouteStartUiState({ planState: 'in_progress', readyToStart: false, isOnline: false }),
    { serverStarted: true, canRequestStart: false, canContinue: true },
    'an authoritative started plan must always be continuable',
  );
  assert.deepEqual(
    module.buildRouteStartUiState({ planState: 'published', readyToStart: true, isOnline: true }),
    { serverStarted: false, canRequestStart: true, canContinue: true },
    'a published plan may start only when every local prerequisite is ready',
  );
  assert.deepEqual(
    module.buildRouteStartUiState({ planState: 'published', readyToStart: false, isOnline: true }),
    { serverStarted: false, canRequestStart: false, canContinue: false },
    'a published plan with missing prerequisites must remain blocked',
  );
  assert.deepEqual(
    module.buildRouteStartUiState({ planState: 'published', readyToStart: true, isOnline: false }),
    { serverStarted: false, canRequestStart: false, canContinue: false },
    'a published ready plan must not call the endpoint while offline',
  );

  for (const planState of [null, 'draft', 'confirmed', 'closed', 'reconciled', 'done']) {
    assert.deepEqual(
      module.buildRouteStartUiState({ planState, readyToStart: true, isOnline: true }),
      { serverStarted: false, canRequestStart: false, canContinue: false },
      `${planState ?? 'missing'} must never call the route-start endpoint`,
    );
  }

  assert.equal(
    module.isCurrentRoutePlan({
      capturedPlanId: 6466,
      currentPlanId: 6466,
      currentRouteStartPlanId: 6466,
    }),
    true,
    'a mutation may run only while both latest stores match its captured plan',
  );
  for (const [currentPlanId, currentRouteStartPlanId] of [
    [7000, 7000],
    [6466, 7000],
    [7000, 6466],
    [null, 6466],
    [6466, null],
  ] as const) {
    assert.equal(
      module.isCurrentRoutePlan({ capturedPlanId: 6466, currentPlanId, currentRouteStartPlanId }),
      false,
      `plan A mutation must be blocked after latest identities become ${currentPlanId}/${currentRouteStartPlanId}`,
    );
  }

  assert.equal(
    module.isSameStartedRoutePlan({
      capturedPlanId: 6466,
      currentPlan: { plan_id: 6466, state: 'in_progress' },
      currentRouteStartPlanId: 6466,
    }),
    true,
  );
  assert.equal(
    module.isSameStartedRoutePlan({
      capturedPlanId: 6466,
      currentPlan: { plan_id: 7000, state: 'in_progress' },
      currentRouteStartPlanId: 7000,
    }),
    false,
    'a successful mutation for plan A followed by a switch to plan B must not navigate',
  );
  assert.equal(
    module.isSameStartedRoutePlan({
      capturedPlanId: 6466,
      currentPlan: { plan_id: 6466, state: 'published' },
      currentRouteStartPlanId: 6466,
    }),
    false,
    'navigation requires the authoritative in-progress state',
  );
  assert.equal(
    module.isSameStartedRoutePlan({
      capturedPlanId: 6466,
      currentPlan: { plan_id: 6466, state: 'in_progress' },
      currentRouteStartPlanId: 7000,
    }),
    false,
    'navigation requires route-start facts to remain bound to the captured plan',
  );

  console.log('route start UI decision tests: ok');
}

main();
