import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');

function main() {
  const authority = read('src/services/routeStartAuthority.ts');
  const logistics = read('src/services/gfLogistics.ts');
  const routeStartAction = read('src/services/routeStartAction.ts');
  const routeStartStore = read('src/stores/useRouteStartStore.ts');
  const routeStore = read('src/stores/useRouteStore.ts');
  const rehydrate = read('src/services/rehydrate.ts');
  const routeStartScreen = read('app/route-start.tsx');
  const operationGate = read('src/components/OperationGate.tsx');
  const routeClose = read('app/route-close.tsx');
  const checklistScreen = read('app/checklist/[planId].tsx');

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
    logistics,
    /export interface StartPlanResult\s*{\s*planId:\s*number;\s*state:\s*'in_progress';\s*}/,
    'route start transport must expose its authoritative success result',
  );
  assert.match(
    logistics,
    /postRest<[^>]+>\(`\$\{GF_BASE\}\/plan\/start`,\s*{\s*plan_id:\s*planId\s*}\)/,
    'startPlan must POST the exact employee endpoint and payload',
  );
  assert.match(
    logistics,
    /Number\(data\?\.plan_id\)\s*!==\s*planId\s*\|\|\s*data\?\.state\s*!==\s*'in_progress'/,
    'startPlan must validate both the matching plan and authoritative state',
  );
  assert.match(
    logistics,
    /throw new Error\('Odoo no confirmó el inicio de la ruta\.'\)/,
    'startPlan must fail closed when Odoo does not confirm the route start',
  );
  assert.doesNotMatch(
    routeStartAction,
    /router|navigate|replace\(/,
    'route-start orchestration must not navigate',
  );

  assert.match(
    routeStore,
    /markPlanStarted:\s*\(planId:\s*number\)\s*=>\s*void/,
    'route store must expose a local authoritative start patch',
  );
  const markActionStart = routeStore.indexOf('markPlanStarted: (planId) => {');
  const markActionEnd = routeStore.indexOf('\n\n  reset:', markActionStart);
  const markAction = routeStore.slice(markActionStart, markActionEnd);
  assert.match(
    markAction,
    /if \(!plan \|\| plan\.plan_id !== planId\) return;/,
    'markPlanStarted must ignore a stale or mismatched plan identity',
  );
  assert.match(
    markAction,
    /const patched:\s*GFPlan\s*=\s*{\s*\.\.\.plan,\s*state:\s*'in_progress'\s*};/,
    'markPlanStarted must create a new started plan object',
  );
  assert.match(
    markAction,
    /set\(\{\s*plan:\s*patched\s*}\);/,
    'markPlanStarted must install the patched current plan',
  );
  assert.match(
    markAction,
    /storeSave\(STORAGE_KEYS\.PLAN,\s*patched\);/,
    'markPlanStarted must persist the patched plan',
  );
  assert.match(
    markAction,
    /useRouteStartStore\.getState\(\)\.syncFromPlan\(patched\);/,
    'markPlanStarted must synchronize route-start facts from the patched plan',
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
    routeStartScreen,
    /import \{ acceptRouteLoad, startPlan \} from '\.\.\/src\/services\/gfLogistics';/,
    'route-start UI must use the real authoritative start transport',
  );
  assert.match(
    routeStartScreen,
    /import \{ confirmAuthoritativeRouteStart \} from '\.\.\/src\/services\/routeStartAction';/,
    'route-start UI must use the authoritative start orchestrator',
  );
  assert.match(
    routeStartScreen,
    /const \[startingRoute, setStartingRoute\] = useState\(false\);/,
    'route-start UI must track an in-flight mutation to prevent duplicate taps',
  );
  assert.match(
    routeStartScreen,
    /const checklistComplete = useRouteStartStore\(\(s\) => s\.checklistComplete\);/,
    'live checklist readiness must come from the persisted plan-scoped fact',
  );
  assert.match(
    routeStartScreen,
    /const routeStartPlanId = useRouteStartStore\(\(s\) => s\.planId\);/,
    'live readiness must compare the persisted fact identity with the current plan',
  );
  assert.match(
    routeStartScreen,
    /const checklistDoneLive = serverStarted \|\| \(routeStartPlanId === planId && checklistComplete\);/,
    'in-progress is authoritative while pre-start checklist facts remain plan-scoped',
  );
  assert.match(
    routeStartScreen,
    /const checklistDisplayStatus: StepStatus = checklistDoneLive && checklistStatus === 'done'\s*\? 'done'\s*:\s*'pending';/,
    'a local checklist status from plan A must render pending for plan B',
  );

  assert.match(
    routeStartScreen,
    /buildInitialLoadAcceptanceState\(plan\)/,
    'daily route start must derive Step 4 from the initial load only',
  );
  assert.doesNotMatch(
    routeStartScreen,
    /buildRouteLoadAcceptanceState\(plan\)/,
    'a pending refill must not make the daily start UI look pending',
  );
  assert.match(
    routeStartScreen,
    /const pending = initialLoadState\.nextPendingInitialLoad;/,
    'the daily-start accept button must target only an initial load',
  );

  const handleStartBegin = routeStartScreen.indexOf('async function handleStartRoute() {');
  const handleStartEnd = routeStartScreen.indexOf('\n\n  async function handleSaveKm', handleStartBegin);
  const handleStart = routeStartScreen.slice(handleStartBegin, handleStartEnd);
  assert.ok(handleStartBegin >= 0, 'route-start UI must define handleStartRoute');
  assert.match(
    handleStart,
    /currentPlan\?\.plan_id !== capturedPlanId/,
    'programmatic start calls must reject a stale rendered plan',
  );
  assert.match(
    handleStart,
    /currentPlan\.state !== 'in_progress'[\s\S]*?currentPlan\.state === 'published'/,
    'the hard guard must allow only in-progress continuation or published readiness',
  );
  assert.match(
    handleStart,
    /await confirmAuthoritativeRouteStart\(\{/,
    'the UI must await authoritative confirmation',
  );
  assert.match(
    handleStart,
    /start:\s*startPlan/,
    'the UI must pass the real endpoint into the orchestrator',
  );
  assert.match(
    handleStart,
    /markStarted:\s*\(\) => useRouteStore\.getState\(\)\.markPlanStarted\(capturedPlanId\)/,
    'the orchestrator must patch only the captured current plan',
  );
  const confirmation = handleStart.indexOf('await confirmAuthoritativeRouteStart({');
  const postConfirmPlan = handleStart.indexOf('const confirmedPlan = useRouteStore.getState().plan;', confirmation);
  const postConfirmStartId = handleStart.indexOf('const confirmedStartPlanId = useRouteStartStore.getState().planId;', postConfirmPlan);
  const raceAlert = handleStart.indexOf('La ruta cambió mientras se iniciaba. Revisa el plan actual.', postConfirmStartId);
  const navigation = handleStart.indexOf('router.replace(', raceAlert);
  assert.ok(
    confirmation >= 0
      && postConfirmPlan > confirmation
      && postConfirmStartId > postConfirmPlan
      && raceAlert > postConfirmStartId
      && navigation > raceAlert,
    'confirmation and the same-plan/state/store race check must precede navigation',
  );
  assert.match(
    handleStart,
    /isSameStartedRoutePlan\(\{\s*capturedPlanId,\s*currentPlan:\s*confirmedPlan,\s*currentRouteStartPlanId:\s*confirmedStartPlanId,\s*\}\)/,
    'navigation must require the same captured plan started in both stores',
  );

  assert.match(
    routeStartScreen,
    /label=\{serverStarted \? 'Continuar ruta' : 'Iniciar ruta'\}/,
    'the button must continue an already started route instead of pretending it is unstarted',
  );
  assert.match(
    routeStartScreen,
    /onPress=\{handleStartRoute\}/,
    'the button must invoke the real start handler',
  );
  assert.match(
    routeStartScreen,
    /disabled=\{startingRoute \|\| !canContinue\}/,
    'the button must reject duplicate taps and all non-startable states',
  );
  assert.match(
    routeStartScreen,
    /loading=\{startingRoute\}/,
    'the button must render mutation progress',
  );
  assert.match(
    routeStartScreen,
    /const serverStarted = plan\?\.state === 'in_progress';[\s\S]*?const canRequestStart = plan\?\.state === 'published' && readyToStartLive;[\s\S]*?const canContinue = serverStarted \|\| canRequestStart;/,
    'UI eligibility must explicitly separate authoritative continuation from published readiness',
  );
  assert.match(
    handleStart,
    /buildRouteStartUiState\(\{\s*planState:\s*currentPlan\.state,\s*readyToStart:\s*currentReadyToStart,\s*\}\)/,
    'the programmatic hard guard must use the exhaustively tested plan-state decision helper',
  );

  assert.match(
    checklistScreen,
    /useRouteStore\.getState\(\)\.plan[\s\S]*?useRouteStartStore\.getState\(\)\.planId/,
    'checklist local updates must check both current plan identities after awaits',
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
  assert.match(
    operationGate,
    /const isTerminalPlan = plan\?\.state === 'closed'[\s\S]*?plan\?\.state === 'reconciled'[\s\S]*?plan\?\.state === 'done';/,
    'operation gate must identify every terminal plan state explicitly',
  );
  assert.match(
    operationGate,
    /const blockHeading = isTerminalPlan \? 'Ruta finalizada' : 'Ruta no iniciada';/,
    'terminal transaction blocks must not claim the route was never started',
  );
  assert.match(
    operationGate,
    /const blockActionLabel = isTerminalPlan \? 'Ir a Inicio' : 'Ir a preparar ruta';/,
    'terminal transaction blocks must offer a safe home action while pre-start blocks preserve route preparation',
  );
  assert.match(
    operationGate,
    /const blockActionPath = isTerminalPlan \? '\/\(tabs\)' : '\/route-start';/,
    'terminal transaction blocks must navigate home while pre-start blocks still navigate to route start',
  );
  assert.match(
    operationGate,
    /<Text style=\{styles\.heading\}>\{blockHeading\}<\/Text>/,
    'operation gate must render the state-aware block heading',
  );
  assert.match(
    operationGate,
    /<Button[\s\S]*?label=\{blockActionLabel\}[\s\S]*?onPress=\{\(\) => router\.replace\(blockActionPath as never\)\}/,
    'operation gate must wire the state-aware label and destination',
  );

  console.log('route start authoritative wiring tests: ok');
}

main();
