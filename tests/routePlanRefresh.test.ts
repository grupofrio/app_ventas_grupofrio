import assert from 'node:assert/strict';

interface GFPlanStub {
  plan_id: number;
  state: string;
  name?: string;
  date?: string;
}

interface SingleFlightContext {
  generation: number;
  isCurrent: () => boolean;
}

interface RoutePlanRefreshModule {
  fetchMyPlan: (
    request: (url: string, data: Record<string, unknown>) => Promise<unknown>,
    endpoint: string,
    date: string,
  ) => Promise<GFPlanStub | null>;
  buildRouteRefreshFailurePatch: (error: unknown) => {
    isLoading: false;
    error: string;
    routeFreshness: 'stale';
  };
  createSingleFlight: <T>() => {
    run: (task: (context: SingleFlightContext) => Promise<T>) => Promise<T>;
    invalidate: () => void;
  };
}

async function loadModule(): Promise<RoutePlanRefreshModule> {
  return await import(
    // @ts-ignore -- import.meta is only used by the Node test runtime.
    new URL('../src/services/routePlanRefresh.ts', import.meta.url).pathname
  ) as RoutePlanRefreshModule;
}

async function testValidDirectAndWrappedPlans(module: RoutePlanRefreshModule) {
  const endpoint = '/gf/logistics/api/employee/my_plan';
  const date = '2026-07-14';
  const plan = {
    plan_id: 6466,
    state: 'published',
    name: 'RPLAN/2026/06466',
    date,
  };

  for (const response of [
    plan,
    { found: true, plan },
    { found: true, ...plan },
    { ok: true, data: { found: true, plan } },
    { ok: true, data: { found: true, ...plan } },
  ]) {
    let requestPayload: Record<string, unknown> | null = null;
    const actual = await module.fetchMyPlan(async (_url, payload) => {
      requestPayload = payload;
      return response;
    }, endpoint, date);

    assert.equal(actual?.plan_id, plan.plan_id);
    assert.equal(actual?.state, plan.state);
    assert.deepEqual(requestPayload, { date });
  }
}

async function testOnlyExplicitFoundFalseIsAuthoritativeNoPlan(module: RoutePlanRefreshModule) {
  const endpoint = '/gf/logistics/api/employee/my_plan';
  const date = '2026-07-14';

  assert.equal(
    await module.fetchMyPlan(async () => ({ ok: true, data: { found: false } }), endpoint, date),
    null,
  );
  assert.equal(await module.fetchMyPlan(async () => ({ found: false }), endpoint, date), null);

  const malformedResponses = [
    null,
    undefined,
    '',
    0,
    true,
    [],
    { data: null },
    { raw: '<html>bad gateway</html>' },
    {},
    { ok: true },
    { ok: true, data: {} },
    { found: true },
    { found: true, plan: null },
    { state: 'published' },
    { plan_id: 0, state: 'published' },
    { plan_id: -1, state: 'published' },
    { plan_id: 1.5, state: 'published' },
    { plan_id: '6466', state: 'published' },
    { plan_id: 6466 },
    { plan_id: 6466, state: 'mystery' },
    { plan_id: 6466, state: 7 },
  ];

  for (const response of malformedResponses) {
    await assert.rejects(
      module.fetchMyPlan(async () => response, endpoint, date),
      (error) => (
        error instanceof Error
        && (error as Error & { code?: string }).code === 'invalid_response'
      ),
      `must reject malformed my_plan response: ${JSON.stringify(response)}`,
    );
  }
}

async function testTransportAndServerFailuresPropagate(module: RoutePlanRefreshModule) {
  const endpoint = '/gf/logistics/api/employee/my_plan';
  const date = '2026-07-14';

  const sessionError = Object.assign(
    new Error('Sesión expirada. Vuelve a iniciar sesión.'),
    { code: 'session_expired' },
  );
  await assert.rejects(
    module.fetchMyPlan(async () => { throw sessionError; }, endpoint, date),
    (error) => error === sessionError && (error as { code?: string }).code === 'session_expired',
  );

  await assert.rejects(
    module.fetchMyPlan(
      async () => ({ ok: false, message: 'Servidor no disponible' }),
      endpoint,
      date,
    ),
    /Servidor no disponible/,
  );
}

async function testTransientFailurePreservesEmptyStopCache(module: RoutePlanRefreshModule) {
  const cachedPlan = { plan_id: 6466, state: 'in_progress' };
  const cachedState = {
    plan: cachedPlan,
    stops: [] as unknown[],
    routeStartReady: true,
    isLoading: true,
    error: null as string | null,
    routeFreshness: 'updated' as const,
  };

  let failure: unknown;
  try {
    await module.fetchMyPlan(
      async () => { throw new Error('Tiempo de espera agotado'); },
      '/gf/logistics/api/employee/my_plan',
      '2026-07-14',
    );
  } catch (error) {
    failure = error;
  }

  const nextState = {
    ...cachedState,
    ...module.buildRouteRefreshFailurePatch(failure),
  };

  assert.equal(nextState.plan, cachedPlan);
  assert.deepEqual(nextState.stops, []);
  assert.equal(nextState.routeStartReady, true);
  assert.equal(nextState.isLoading, false);
  assert.equal(nextState.error, 'Tiempo de espera agotado');
  assert.equal(nextState.routeFreshness, 'stale');
}

async function testOverlappingRefreshesJoinActiveRequest(module: RoutePlanRefreshModule) {
  const flight = module.createSingleFlight<number>();
  let resolveActive!: (value: number) => void;
  const active = new Promise<number>((resolve) => {
    resolveActive = resolve;
  });
  let taskCalls = 0;
  let overlappingSettled = false;

  const first = flight.run(async () => {
    taskCalls += 1;
    return active;
  });
  const overlapping = flight.run(async () => {
    taskCalls += 1;
    return 999;
  });
  void overlapping.then(() => {
    overlappingSettled = true;
  });

  await Promise.resolve();
  assert.equal(taskCalls, 1, 'overlap must not launch a second transport request');
  assert.equal(overlappingSettled, false, 'overlap must wait for the active refresh');

  resolveActive(6466);
  assert.equal(await first, 6466);
  assert.equal(await overlapping, 6466);

  assert.equal(
    await flight.run(async () => {
      taskCalls += 1;
      return 7000;
    }),
    7000,
    'a later refresh must run after the active request settles',
  );
  assert.equal(taskCalls, 2);
}

async function testInvalidationStartsNewGenerationAndBlocksOldWrites(
  module: RoutePlanRefreshModule,
) {
  const flight = module.createSingleFlight<number>();
  let resolveOld!: (value: number) => void;
  let resolveNew!: (value: number) => void;
  const oldRequest = new Promise<number>((resolve) => { resolveOld = resolve; });
  const newRequest = new Promise<number>((resolve) => { resolveNew = resolve; });
  const generations: number[] = [];
  let fetchCalls = 0;
  let visiblePlanId: number | null = null;

  const oldLoad = flight.run(async (context) => {
    fetchCalls += 1;
    generations.push(context.generation);
    const planId = await oldRequest;
    if (context.isCurrent()) visiblePlanId = planId;
    return planId;
  });

  flight.invalidate();
  visiblePlanId = null;

  const newLoad = flight.run(async (context) => {
    fetchCalls += 1;
    generations.push(context.generation);
    const planId = await newRequest;
    if (context.isCurrent()) visiblePlanId = planId;
    return planId;
  });
  const joinedNewLoad = flight.run(async () => {
    fetchCalls += 1;
    return 9999;
  });

  assert.equal(fetchCalls, 2, 'new generation must start without waiting for old employee request');
  assert.notEqual(generations[0], generations[1], 'reset must advance the request generation');

  resolveOld(6466);
  assert.equal(await oldLoad, 6466);
  assert.equal(visiblePlanId, null, 'old employee request must not repopulate reset state');
  assert.equal(fetchCalls, 2, 'settling old generation must not clear the new active flight');

  resolveNew(7000);
  assert.equal(await newLoad, 7000);
  assert.equal(await joinedNewLoad, 7000);
  assert.equal(visiblePlanId, 7000, 'current employee request must win');
}

async function main() {
  const module = await loadModule();

  await testValidDirectAndWrappedPlans(module);
  await testOnlyExplicitFoundFalseIsAuthoritativeNoPlan(module);
  await testTransportAndServerFailuresPropagate(module);
  await testTransientFailurePreservesEmptyStopCache(module);
  await testOverlappingRefreshesJoinActiveRequest(module);
  await testInvalidationStartsNewGenerationAndBlocksOldWrites(module);

  console.log('route plan refresh tests: ok');
}

void main();
