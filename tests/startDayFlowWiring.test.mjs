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

  assert.match(routeStart, /1 · Checklist de unidad/);
  assert.match(routeStart, /2 · Carga/);
  assert.match(routeStart, /3 · Preparar plan del día/);
  assert.match(routeStart, /4 · Iniciar ruta/);
  assert.doesNotMatch(routeStart, /3 · KM inicial/, 'KM must not be a numbered blocking step');

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
