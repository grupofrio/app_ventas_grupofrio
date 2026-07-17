import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');

function main() {
  const routeStart = read('app/route-start.tsx');
  const checklist = read('app/checklist/[planId].tsx');
  const routeClose = read('app/route-close.tsx');
  const routeStartStore = read('src/stores/useRouteStartStore.ts');

  assert.doesNotMatch(
    routeStart,
    /useRouteStartStore\(\(s\) => s\.setLoadAccepted\)|\bsetLoadAccepted\(/,
    'route-start no debe instalar carga de un render viejo con un setter sin plan',
  );

  assert.match(
    routeStart,
    /ensureChecklistReady\(capturedPlanId\)/,
    'Iniciar operación debe crear/cargar el checklist, no marcar listo cuando getVehicleChecklist regresa null',
  );
  assert.doesNotMatch(
    routeStart,
    /getVehicleChecklist\(planId\)/,
    'Iniciar operación no debe usar una lectura que deja null como checklist listo',
  );
  assert.match(
    routeStart,
    /chooseAuthoritativeKm/,
    'KM inicial en inicio debe usar un valor autoritativo de Odoo',
  );
  assert.match(
    routeClose,
    /chooseAuthoritativeKm/,
    'KM de cierre debe calcular contra el KM inicial autoritativo de Odoo',
  );
  assert.doesNotMatch(
    routeClose,
    /kmInitialStore\s*\?\?/,
    'Cierre no debe priorizar el KM local del teléfono sobre Odoo',
  );

  assert.match(
    routeStartStore,
    /setChecklistCompleteForPlan:\s*\(planId:\s*number,\s*done:\s*boolean\)\s*=>\s*void/,
    'el store debe exponer escritura de checklist ligada al plan capturado',
  );
  assert.match(
    routeStartStore,
    /setKmInitialForPlan:\s*\(planId:\s*number,\s*km:\s*number\s*\|\s*null\)\s*=>\s*void/,
    'el store debe exponer escritura de KM ligada al plan capturado',
  );

  for (const [actionName, valueName] of [
    ['setChecklistCompleteForPlan', 'done'],
    ['setKmInitialForPlan', 'km'],
  ]) {
    const start = routeStartStore.indexOf(`${actionName}: (planId, ${valueName}) => {`);
    const end = routeStartStore.indexOf('\n\n  ', start + 1);
    const action = routeStartStore.slice(start, end);
    assert.ok(start >= 0, `${actionName} debe estar implementado`);
    assert.match(
      action,
      /if \(get\(\)\.planId !== planId\) return;/,
      `${actionName} debe ignorar respuestas tardías de otro plan`,
    );
    assert.equal((action.match(/\bset\(/g) || []).length, 1, `${actionName} debe escribir una sola vez`);
    assert.equal((action.match(/\brecompute\(/g) || []).length, 1, `${actionName} debe recalcular una sola vez`);
    assert.equal((action.match(/\bpersist\(/g) || []).length, 1, `${actionName} debe persistir una sola vez`);
  }

  assert.doesNotMatch(
    routeStart,
    /useRouteStartStore\(\(s\) => s\.setChecklistComplete\)/,
    'route-start no debe usar el setter de checklist sin plan en rutas async',
  );
  assert.doesNotMatch(
    routeStart,
    /useRouteStartStore\(\(s\) => s\.setKmInitial\)/,
    'route-start no debe usar el setter de KM sin plan en rutas async',
  );
  assert.doesNotMatch(
    checklist,
    /useRouteStartStore\(\(s\) => s\.setChecklistComplete\)/,
    'checklist no debe usar el setter de checklist sin plan en rutas async',
  );
  assert.doesNotMatch(
    checklist,
    /useRouteStartStore\(\(s\) => s\.setKmInitial\)/,
    'checklist no debe usar el setter de KM sin plan en rutas async',
  );

  assert.match(
    routeStart,
    /setChecklistCompleteForPlan\(capturedPlanId, done\)/,
    'la observación async del checklist debe escribir usando el plan capturado',
  );
  assert.match(
    routeStart,
    /setKmInitialForPlan\(capturedPlanId, storedKm\)/,
    'la respuesta async de KM del hub debe escribir usando el plan capturado',
  );
  assert.match(
    checklist,
    /setChecklistCompleteForPlan\(capturedPlanId, true\)/,
    'completar un checklist debe escribir usando el plan capturado',
  );
  assert.match(
    checklist,
    /setKmInitialForPlan\(capturedPlanId, chooseAuthoritativeKm\(\{ backendKm: res\.departure_km \}\)\)/,
    'el KM extraído del checklist debe escribir usando el plan capturado',
  );

  assert.match(
    routeStart,
    /function isCurrentPlan\(capturedPlanId: number\)[\s\S]*?isCurrentRoutePlan\(\{[\s\S]*?currentPlanId: currentPlan\?\.plan_id \?\? null,[\s\S]*?currentRouteStartPlanId: currentStartPlanId/,
    'los updates locales del hub deben comprobar ambos stores',
  );
  assert.match(
    checklist,
    /function isCurrentPlan\(capturedPlanId: number\)[\s\S]*?isCurrentRoutePlan\(\{[\s\S]*?currentPlanId: currentPlan\?\.plan_id \?\? null,[\s\S]*?currentRouteStartPlanId: currentStartPlanId/,
    'los updates locales del checklist deben comprobar ambos stores',
  );

  const refreshStart = routeStart.indexOf('const refresh = useCallback(async () => {');
  const refreshEnd = routeStart.indexOf('\n\n  async function handleAcceptLoad', refreshStart);
  const refresh = routeStart.slice(refreshStart, refreshEnd);
  assert.match(
    refresh,
    /const capturedPlanId = planId;/,
    'refresh debe capturar la identidad del plan antes de esperar',
  );
  const refreshLoad = refresh.indexOf('await loadPlan({ force: true });');
  const refreshIdentityGuard = refresh.indexOf('if (!isCurrentPlan(capturedPlanId)) return;', refreshLoad);
  const refreshChecklist = refresh.indexOf('await ensureChecklistReady(capturedPlanId)', refreshLoad);
  assert.ok(
    refreshLoad >= 0 && refreshIdentityGuard > refreshLoad && refreshChecklist > refreshIdentityGuard,
    'refresh debe abortar tras loadPlan si cualquiera de los stores cambió antes de tocar checklist en servidor',
  );
  const refreshKmPaint = refresh.indexOf('setKmInitialBackend({', refreshIdentityGuard);
  assert.ok(
    refreshKmPaint > refreshIdentityGuard && refreshKmPaint < refreshChecklist,
    'el KM local del backend solo debe pintarse tras validar ambos stores',
  );
  assert.match(
    refresh,
    /if \(isCurrentPlan\(capturedPlanId\)\) \{[\s\S]*?setChecklistStatus\(/,
    'el estado local del checklist solo debe pintarse si ambos stores siguen en el plan capturado',
  );
  assert.doesNotMatch(
    refresh,
    /setChecklistCompleteForPlan\(capturedPlanId, false\)/,
    'una falla transitoria no debe borrar el último hecho de checklist del plan',
  );
  assert.match(
    refresh,
    /const preservedChecklist = useRouteStartStore\.getState\(\)\.checklistComplete;[\s\S]*?setChecklistStatus\(preservedChecklist \? 'done' : 'pending'\)/,
    'una falla transitoria debe conservar el hecho previo del checklist para el mismo plan',
  );

  const saveKmStart = routeStart.indexOf('function confirmSaveKm(km: number) {');
  const saveKmEnd = routeStart.indexOf('\n\n  // ── Empty state', saveKmStart);
  const saveKm = routeStart.slice(saveKmStart, saveKmEnd);
  assert.match(
    saveKm,
    /const capturedPlanId = planId;/,
    'guardar KM debe capturar el plan antes de abrir el callback async',
  );
  assert.match(
    saveKm,
    /onPress: async \(\) => \{\s*if \(!isCurrentPlan\(capturedPlanId\)\) \{\s*showRouteChangedAlert\(\);\s*return;\s*\}[\s\S]*?await updateKm\(capturedPlanId, 'departure', km\)/,
    'guardar KM debe releer ambos stores inmediatamente antes de mutar Odoo',
  );
  assert.match(
    saveKm,
    /if \(isCurrentPlan\(capturedPlanId\)\) \{\s*setKmInitialBackend\(\{ planId: capturedPlanId, km: storedKm \}\);/,
    'la respuesta de KM solo debe actualizar la pantalla del plan capturado',
  );
  assert.match(
    saveKm,
    /if \(isCurrentPlan\(capturedPlanId\)\) \{[\s\S]*?setKmInput\(''\);/,
    'la respuesta de KM no debe limpiar el input de un plan nuevo',
  );
  assert.match(
    routeStart,
    /backendKm:\s*kmInitialBackend\?\.planId === planId \? kmInitialBackend\.km : null/,
    'un KM local previo nunca debe mostrarse ni habilitar un plan nuevo antes del siguiente efecto',
  );

  const acceptStart = routeStart.indexOf('async function handleAcceptLoad() {');
  const acceptEnd = routeStart.indexOf('\n\n  useFocusEffect(', acceptStart);
  const accept = routeStart.slice(acceptStart, acceptEnd);
  assert.match(
    accept,
    /onPress: async \(\) => \{\s*if \(!isCurrentPlan\(capturedPlanId\)\) \{\s*showRouteChangedAlert\(\);\s*return;\s*\}[\s\S]*?await acceptRouteLoad\(capturedPlanId, pending\.picking_id\)/,
    'aceptar carga debe releer ambos stores inmediatamente antes de mutar Odoo',
  );

  console.log('route start checklist/km wiring tests: ok');
}

main();
