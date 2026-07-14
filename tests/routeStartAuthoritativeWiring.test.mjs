import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');

function main() {
  const authority = read('src/services/routeStartAuthority.ts');
  const routeStartStore = read('src/stores/useRouteStartStore.ts');
  const routeStore = read('src/stores/useRouteStore.ts');
  const rehydrate = read('src/services/rehydrate.ts');
  const routeStartScreen = read('app/route-start.tsx');

  assert.match(
    authority,
    /export interface RouteStartPersistedFacts\s*{/,
    'route-start authority must expose the persisted-facts contract',
  );
  assert.match(
    authority,
    /export function mergeRouteStartPlanSnapshot\(/,
    'route-start authority must expose the pure authoritative merge',
  );

  assert.match(
    routeStartStore,
    /syncFromPlan:\s*\(plan:\s*GFPlan\)\s*=>\s*void/,
    'route-start store state must expose syncFromPlan',
  );
  assert.match(
    routeStartStore,
    /syncFromPlan:\s*\(plan\)\s*=>\s*{[\s\S]*?deriveRouteStartPlanSnapshot\(plan\)[\s\S]*?mergeRouteStartPlanSnapshot\(/,
    'syncFromPlan must derive and merge authoritative plan facts',
  );
  const syncActionStart = routeStartStore.indexOf('syncFromPlan: (plan) => {');
  const syncActionEnd = routeStartStore.indexOf('\n\n  reset:', syncActionStart);
  const syncAction = routeStartStore.slice(syncActionStart, syncActionEnd);
  assert.equal((syncAction.match(/\bset\(/g) || []).length, 1, 'syncFromPlan must update Zustand once');
  assert.equal((syncAction.match(/\brecompute\(/g) || []).length, 1, 'syncFromPlan must recompute readiness once');
  assert.equal((syncAction.match(/\bpersist\(/g) || []).length, 1, 'syncFromPlan must persist once');
  assert.match(
    syncAction,
    /logInfo\('general', 'route_start_sync_plan', \{\s*planId: snapshot\.planId,\s*planState: snapshot\.planState,\s*\}\)/,
    'syncFromPlan telemetry must contain only safe plan id/state facts',
  );

  const planRead = routeStore.indexOf('const plan = await getMyPlan();');
  const planSync = routeStore.indexOf('useRouteStartStore.getState().syncFromPlan(plan);', planRead);
  const earlyReturnPolicy = routeStore.indexOf('if (!shouldReloadRouteStops({', planRead);
  assert.ok(planRead >= 0 && planSync > planRead, 'loadPlan must sync a non-null plan');
  assert.ok(
    planSync < earlyReturnPolicy,
    'loadPlan must sync route-start facts before its plan-version early return',
  );
  assert.equal(
    (routeStore.match(/useRouteStartStore\.getState\(\)\.syncFromPlan\(plan\);/g) || []).length,
    1,
    'loadPlan must have one authoritative synchronization point covering both stop branches',
  );

  const noPlanBranch = routeStore.indexOf('if (!plan) {', planRead);
  const retainedCacheReturn = routeStore.indexOf("error: 'No se pudo actualizar la ruta; mostrando ruta guardada'", noPlanBranch);
  const definitiveReset = routeStore.indexOf('useRouteStartStore.getState().reset();', retainedCacheReturn);
  const noPlanState = routeStore.indexOf("error: 'Sin plan para hoy'", retainedCacheReturn);
  assert.ok(
    retainedCacheReturn >= 0 && definitiveReset > retainedCacheReturn && definitiveReset < noPlanState,
    'only the definitive online no-plan path must reset route-start facts',
  );
  assert.equal(
    (routeStore.match(/useRouteStartStore\.getState\(\)\.reset\(\);/g) || []).length,
    1,
    'offline and retained-cache paths must not reset route-start facts',
  );

  const validCacheBranch = rehydrate.indexOf('if (isTodayPlan && isCurrentEmployeePlan) {');
  const cachedSync = rehydrate.indexOf('useRouteStartStore.getState().syncFromPlan(plan);', validCacheBranch);
  const exposeCachedPlan = rehydrate.indexOf('useRouteStore.setState({', validCacheBranch);
  const rejectedCacheBranch = rehydrate.indexOf('} else {', exposeCachedPlan);
  assert.ok(validCacheBranch >= 0 && cachedSync > validCacheBranch, 'validated cache must sync route-start facts');
  assert.ok(cachedSync < exposeCachedPlan, 'validated cache must sync before exposing the cached plan');
  assert.ok(cachedSync < rejectedCacheBranch, 'stale or wrong-employee cache must never be synchronized');
  assert.equal(
    (rehydrate.match(/useRouteStartStore\.getState\(\)\.syncFromPlan\(plan\);/g) || []).length,
    1,
    'rehydration must not synchronize from any rejected-cache branch',
  );

  assert.match(
    routeStartScreen,
    /await loadPlan\(\{\s*force:\s*true\s*\}\)/,
    'route-start refresh must flow through the route-store plan loader',
  );
  assert.match(
    routeStore,
    /loadPlan:[\s\S]*?syncFromPlan\(plan\)/,
    'route-start plan refresh must update persisted readiness, not only component-local backend KM',
  );

  console.log('route start authoritative wiring tests: ok');
}

main();
