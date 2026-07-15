import assert from 'node:assert/strict';

interface GFPlanStub {
  plan_id: number;
  state: string;
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
    run: (task: () => Promise<T>) => Promise<T>;
  };
}

async function loadModule(): Promise<RoutePlanRefreshModule> {
  return await import(
    // @ts-ignore -- import.meta is only used by the Node test runtime.
    new URL('../src/services/routePlanRefresh.ts', import.meta.url).pathname
  ) as RoutePlanRefreshModule;
}

async function testAuthoritativeNoPlanIsDistinctFromFailure(module: RoutePlanRefreshModule) {
  const endpoint = '/gf/logistics/api/employee/my_plan';
  const date = '2026-07-14';

  assert.equal(
    await module.fetchMyPlan(async () => ({ ok: true, data: { found: false } }), endpoint, date),
    null,
  );
  assert.equal(await module.fetchMyPlan(async () => null, endpoint, date), null);

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

async function main() {
  const module = await loadModule();

  await testAuthoritativeNoPlanIsDistinctFromFailure(module);
  await testTransientFailurePreservesEmptyStopCache(module);
  await testOverlappingRefreshesJoinActiveRequest(module);

  console.log('route plan refresh tests: ok');
}

void main();
