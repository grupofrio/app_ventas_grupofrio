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
  const operationGate = read('src/components/OperationGate.tsx');
  const routeClose = read('app/route-close.tsx');

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
  const definitiveInvalidation = routeStore.indexOf('await Promise.all([', retainedCacheReturn);
  const definitiveReset = routeStore.indexOf('useRouteStartStore.getState().reset();', retainedCacheReturn);
  const noPlanState = routeStore.indexOf("error: 'Sin plan para hoy'", retainedCacheReturn);
  assert.ok(
    retainedCacheReturn >= 0
      && definitiveInvalidation > retainedCacheReturn
      && definitiveReset > definitiveInvalidation
      && definitiveReset < noPlanState,
    'the definitive online no-plan path must durably invalidate route cache before resetting readiness',
  );
  const invalidationBlock = routeStore.slice(definitiveInvalidation, definitiveReset);
  assert.match(
    invalidationBlock,
    /storeRemove\(STORAGE_KEYS\.PLAN\)/,
    'definitive no-plan must remove the cached plan so it cannot be restored after restart',
  );
  assert.match(
    invalidationBlock,
    /storeRemove\(STORAGE_KEYS\.STOPS\)/,
    'definitive no-plan must remove cached stops so an obsolete empty route cannot rehydrate',
  );
  assert.match(
    invalidationBlock,
    /storeRemove\(STORAGE_KEYS\.VISIT_STATE\)/,
    'definitive no-plan must remove the persisted active visit',
  );
  assert.equal(
    (routeStore.match(/useRouteStartStore\.getState\(\)\.reset\(\);/g) || []).length,
    1,
    'offline and retained-cache paths must not reset route-start facts',
  );
  assert.equal(
    (routeStore.match(/storeRemove\(STORAGE_KEYS\.(?:PLAN|STOPS|VISIT_STATE)\)/g) || []).length,
    3,
    'offline and retained-cache paths must not delete durable route state',
  );
  assert.match(
    routeStore.slice(definitiveReset, routeStore.indexOf('return;', definitiveReset)),
    /set\(\{[\s\S]*?plan:\s*null,[\s\S]*?stops:\s*\[\],[\s\S]*?lastSync:\s*null,[\s\S]*?planVersionToken:\s*null,[\s\S]*?stopsCompleted:\s*0,[\s\S]*?stopsTotal:\s*0,[\s\S]*?progressPct:\s*0,[\s\S]*?\}\)/,
    'definitive no-plan must clear all in-memory route and derived progress state',
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

  assert.match(
    operationGate,
    /const plan = useRouteStore\(\(s\) => s\.plan\);/,
    'operation gate must read the full authoritative plan, not reduce it to presence',
  );
  assert.match(
    operationGate,
    /const routeStart = useRouteStartStore\(\);/,
    'operation gate must read the persisted route-start plan identity and readiness together',
  );
  assert.match(
    operationGate,
    /planState:\s*plan\?\.state \?\? null,/,
    'operation gate must pass the authoritative Odoo state to readiness',
  );
  assert.match(
    operationGate,
    /planMatchesReadiness:\s*plan\?\.plan_id === routeStart\.planId,/,
    'operation gate must scope cached readiness facts to the current plan',
  );
  assert.match(
    operationGate,
    /mode = 'transaction'/,
    'operation gate must default to transaction semantics',
  );
  assert.match(
    operationGate,
    /deriveOperationReadiness\(\{[\s\S]*?mode,[\s\S]*?\}\)/,
    'operation gate must pass its operation mode to readiness',
  );
  assert.doesNotMatch(
    operationGate,
    /hasActivePlan/,
    'operation gate must not collapse authoritative state to a truthy plan check',
  );
  assert.match(
    routeClose,
    /<OperationGate title="Cerrar ruta" mode="close">/,
    'route close must opt into idempotent close-mode gating',
  );

  console.log('route start authoritative wiring tests: ok');
}

main();
