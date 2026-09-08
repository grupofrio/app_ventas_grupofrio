import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');

function main() {
  const routeStart = read('app/route-start.tsx');
  const checklist = read('app/checklist/[planId].tsx');
  const logistics = read('src/services/gfLogistics.ts');
  const prepCard = read('src/components/domain/RoutePreparationCard.tsx');
  const refill = read('app/refill-accept.tsx');
  const routeScreen = read('app/(tabs)/route.tsx');
  const home = read('app/(tabs)/index.tsx');
  const routeStartStore = read('src/stores/useRouteStartStore.ts');
  const routePreparationStore = read('src/stores/useRoutePreparationStore.ts');

  assert.match(routeStart, /1 · Checklist de unidad/);
  assert.match(routeStart, /2 · Carga/);
  assert.match(routeStart, /3 · Preparar plan del día/);
  assert.match(routeStart, /4 · Iniciar ruta/);
  assert.doesNotMatch(routeStart, /3 · KM inicial/, 'KM must not be a numbered blocking step');

  assert.match(routeStartStore, /routeStartedPlanId:\s*number \| null/);
  assert.match(routeStartStore, /markRouteStartedForPlan/);
  assert.match(routeStart, /markRouteStartedForPlan\(capturedPlanId\)/);
  assert.match(
    routeScreen,
    /<OperationGate title="Ruta">/,
    'la pestaña Ruta debe aplicar el mismo gate del inicio del día',
  );
  assert.doesNotMatch(
    home,
    /opReady[\s\S]{0,220}target:\s*'\/\(tabs\)\/route'/,
    'checklist+KM+carga no deben saltar la preparación ni el botón Iniciar ruta',
  );
  assert.match(
    routeStart,
    /useRoutePreparationStore\.getState\(\)\.prepareRouteData\(\)/,
    'aceptar la carga inicial debe disparar automáticamente la preparación',
  );
  assert.match(
    routeStart,
    /No encontramos la carga inicial de esta ruta/,
    'la carga ausente debe mostrarse como problema bloqueante de asignación',
  );
  assert.match(routeStart, /Actualizar carga/, 'la carga ausente debe ofrecer una actualización explícita');

  assert.match(routeStart, /computeStartDayStepGates\(/);
  assert.match(routeStart, /START_DAY_COPY\.checklistSyncPending/);
  assert.match(routeStart, /START_DAY_COPY\.completeChecklistFirst|startDayGates\.loadLockMessage/);
  assert.match(routeStart, /START_DAY_COPY\.acceptLoadToPrepare|startDayGates\.prepareLockMessage/);
  assert.match(routeStart, /START_DAY_COPY\.loadRejectedWaiting/);

  assert.match(routeStart, /Rechazar carga/);
  assert.match(routeStart, /Aceptar carga/);
  assert.match(routeStart, /rejectRouteLoad\(/);
  assert.match(routeStart, /buildRouteLoadRejectPayload\(/);
  assert.match(routeStart, /Cancelar no rechaza/);
  assert.doesNotMatch(routeStart, /pt_transfer\/reject/);

  assert.match(prepCard, /locked \? \(/);
  assert.match(routeStart, /locked=\{!startDayGates\.prepareUnlocked\}/);
  assert.match(prepCard, /describePreparationFailure/, 'la tarjeta debe resolver nombres de pendientes desde la ruta local');
  assert.match(prepCard, /failures\.slice\(0, 8\)\.map/, 'la tarjeta debe mostrar una lista acotada de pendientes');
  assert.match(prepCard, /Pendientes de precio/, 'la lista debe explicar qué clientes requieren reintento');
  assert.doesNotMatch(
    prepCard,
    /<Text style=\{styles\.title\}>Bundle vencido<\/Text>/,
    'la interfaz del vendedor no debe mostrar el nombre técnico bundle',
  );
  const noProductsStart = routePreparationStore.indexOf('if (products.length === 0)');
  const noProductsEnd = routePreparationStore.indexOf('// ── Step 3:', noProductsStart);
  const noProductsBranch = routePreparationStore.slice(noProductsStart, noProductsEnd);
  assert.match(noProductsBranch, /preparedAt:\s*null/);
  assert.match(noProductsBranch, /preparedPlanId:\s*null/);
  assert.doesNotMatch(
    noProductsBranch,
    /preparedAt:\s*Date\.now\(\)/,
    'si faltan productos, la app no debe presentar una ruta parcial como preparada',
  );

  assert.match(checklist, /Guardar y completar checklist/);
  assert.doesNotMatch(checklist, /label=\{check\.answered \? 'Actualizar' : 'Guardar'\}/);
  assert.match(checklist, /validateRequiredChecklistDrafts\(checks, drafts\)/);
  const saveStart = checklist.indexOf('async function handleSaveAndComplete()');
  const validationGate = checklist.indexOf('if (!validation.ok)', saveStart);
  const submitUnsubmitted = checklist.indexOf('await submitUnsubmittedAnswers', saveStart);
  assert.ok(
    saveStart >= 0 && validationGate > saveStart && submitUnsubmitted > validationGate,
    'local validation in handleSaveAndComplete must run before submitting answers',
  );

  assert.match(logistics, /route_plan\/reject_load/);
  assert.doesNotMatch(
    logistics.slice(logistics.indexOf('export async function rejectRouteLoad')),
    /pt_transfer\/reject/,
  );

  assert.match(refill, /runRouteLoadAcceptAndRefresh/, 'mid-route refill accept must stay intact');
  assert.doesNotMatch(refill, /computeStartDayStepGates/, 'start-of-day locks must not wrap refill-accept');

  console.log('start-day flow wiring tests: ok');
}

main();
