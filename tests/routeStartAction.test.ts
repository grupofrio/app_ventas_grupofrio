import assert from 'node:assert/strict';

interface RoutePlanSnapshot {
  plan_id: number;
  state: string;
}

interface StartPlanResult {
  planId: number;
  state: 'in_progress';
}

interface RouteStartActionModule {
  confirmAuthoritativeRouteStart: (input: {
    planId: number;
    currentState: string | null;
    start: (planId: number) => Promise<StartPlanResult>;
    refresh: () => Promise<RoutePlanSnapshot | null>;
    markStarted: () => void;
  }) => Promise<StartPlanResult>;
}

async function loadModule(): Promise<RouteStartActionModule> {
  return await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/routeStartAction.ts', import.meta.url).pathname
  ) as RouteStartActionModule;
}

async function testAlreadyStartedSkipsMutation(module: RouteStartActionModule) {
  const calls: string[] = [];

  const result = await module.confirmAuthoritativeRouteStart({
    planId: 6466,
    currentState: 'in_progress',
    start: async () => {
      calls.push('start');
      throw new Error('mutation must not run');
    },
    refresh: async () => {
      calls.push('refresh');
      return null;
    },
    markStarted: () => calls.push('mark'),
  });

  assert.deepEqual(result, { planId: 6466, state: 'in_progress' });
  assert.deepEqual(calls, ['mark']);
}

async function testMutationSuccessMarksBeforeBestEffortRefresh(module: RouteStartActionModule) {
  const calls: string[] = [];

  const result = await module.confirmAuthoritativeRouteStart({
    planId: 6466,
    currentState: 'published',
    start: async (planId) => {
      calls.push(`start:${planId}`);
      return { planId, state: 'in_progress' };
    },
    markStarted: () => calls.push('mark'),
    refresh: async () => {
      calls.push('refresh');
      throw new Error('refresh unavailable');
    },
  });

  assert.deepEqual(result, { planId: 6466, state: 'in_progress' });
  assert.deepEqual(calls, ['start:6466', 'mark', 'refresh']);
}

async function testMutationErrorRecoversFromMatchingRefresh(module: RouteStartActionModule) {
  const timeout = new Error('timeout');
  const calls: string[] = [];

  const result = await module.confirmAuthoritativeRouteStart({
    planId: 6466,
    currentState: 'published',
    start: async () => {
      calls.push('start');
      throw timeout;
    },
    refresh: async () => {
      calls.push('refresh');
      return { plan_id: 6466, state: 'in_progress' };
    },
    markStarted: () => calls.push('mark'),
  });

  assert.deepEqual(result, { planId: 6466, state: 'in_progress' });
  assert.deepEqual(calls, ['start', 'refresh', 'mark']);
}

async function testMutationErrorRethrowsWhenRefreshIsNotStarted(module: RouteStartActionModule) {
  for (const refreshed of [
    { plan_id: 6466, state: 'published' },
    null,
  ]) {
    const original = new Error(`start failed: ${refreshed?.state ?? 'null'}`);
    let marks = 0;
    let refreshes = 0;

    await assert.rejects(
      module.confirmAuthoritativeRouteStart({
        planId: 6466,
        currentState: 'published',
        start: async () => { throw original; },
        refresh: async () => {
          refreshes += 1;
          return refreshed;
        },
        markStarted: () => { marks += 1; },
      }),
      (error) => error === original,
    );

    assert.equal(refreshes, 1);
    assert.equal(marks, 0);
  }
}

async function testMutationErrorDoesNotRecoverAnotherStartedPlan(module: RouteStartActionModule) {
  const original = new Error('start failed');
  let marks = 0;

  await assert.rejects(
    module.confirmAuthoritativeRouteStart({
      planId: 6466,
      currentState: 'published',
      start: async () => { throw original; },
      refresh: async () => ({ plan_id: 7000, state: 'in_progress' }),
      markStarted: () => { marks += 1; },
    }),
    (error) => error === original,
  );

  assert.equal(marks, 0);
}

async function main() {
  const module = await loadModule();

  await testAlreadyStartedSkipsMutation(module);
  await testMutationSuccessMarksBeforeBestEffortRefresh(module);
  await testMutationErrorRecoversFromMatchingRefresh(module);
  await testMutationErrorRethrowsWhenRefreshIsNotStarted(module);
  await testMutationErrorDoesNotRecoverAnotherStartedPlan(module);

  console.log('route start action tests: ok');
}

main();
