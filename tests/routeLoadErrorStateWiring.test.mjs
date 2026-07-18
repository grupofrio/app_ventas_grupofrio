import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * Wiring PR-2 — estado vacío/error de ruta CEDIS:
 *  #1 plan/stops usan timeout de LECTURA (10s), no el de mutación (45s);
 *  #2 getPlanStopsResult devuelve estado discriminado (no [] silencioso);
 *  #3 loadPlan guarda loadOutcome estructurado (no_plan vs error clasificado);
 *  #4 route-start diferencia copy + ofrece Reintentar;
 *  #5 Home reusa el criterio isStandardNoPlanError.
 */
const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const gf = read('src/services/gfLogistics.ts');
const store = read('src/stores/useRouteStore.ts');
const routeStart = read('app/route-start.tsx');
const home = read('app/(tabs)/index.tsx');
const outcome = read('src/services/routeLoadOutcome.ts');

// #1 timeout de lectura para plan y stops
assert(/getMyPlan[\s\S]*?timeoutMs:\s*DEFAULT_READ_TIMEOUT_MS/.test(gf),
  'getMyPlan debe usar el timeout de lectura');
assert(/getPlanStopsResult[\s\S]*?timeoutMs:\s*DEFAULT_READ_TIMEOUT_MS/.test(gf),
  'getPlanStopsResult debe usar el timeout de lectura');

// #2 getPlanStopsResult discriminado: ok:false → access_denied/stops_error; catch clasifica.
assert(/export async function getPlanStopsResult/.test(gf), 'existe getPlanStopsResult');
assert(gf.includes("status: 'ok'"), 'getPlanStopsResult devuelve status ok');
assert(gf.includes('isAccessDeniedMessage'), 'distingue access_denied de stops_error');
assert(/classifyRouteLoadError\(error\)/.test(gf), 'clasifica el error en el catch de stops');
// El wrapper compat sigue existiendo (callers que solo quieren el array).
assert(/export async function getPlanStops\(/.test(gf), 'getPlanStops (compat) sigue existiendo');

// P2 (Codex): respuesta exitosa MALFORMADA no se convierte en ok+[]. Solo un
// array explícito de stops (extractPlanStopsArray.found) cuenta como 'ok'.
assert(gf.includes('extractPlanStopsArray'), 'getPlanStopsResult usa extractPlanStopsArray');
assert(/!extracted\.found[\s\S]*?status:\s*'stops_error'/.test(gf),
  'respuesta exitosa sin array de stops válido → stops_error, NO ok+[]');
// Ya no existe el pickStops que devolvía [] ante shapes inesperados.
assert(!/const pickStops = /.test(gf), 'se eliminó pickStops (colapsaba malformado a [])');

// #3 loadPlan guarda loadOutcome
assert(/loadOutcome:/.test(store), 'el store expone loadOutcome');
assert(/status:\s*'no_plan'/.test(store), 'no_plan real setea status no_plan');
assert(store.includes('getPlanStopsResult'), 'loadPlan usa getPlanStopsResult');
assert(store.includes('classifyRouteLoadError'), 'el catch de loadPlan clasifica el error');
// P2 (Codex): empty_route SOLO cuando el stops result es 'ok' con 0 paradas —
// nunca cuando fue stops_error/invalid. Se deriva de la rama:
//   stopsResult.status !== 'ok' ? {status:...} : total === 0 ? empty_route : null
assert(/status:\s*'empty_route'/.test(store), 'ruta ok con 0 paradas = empty_route');
assert(/stopsResult\.status !== 'ok'[\s\S]*?:\s*total === 0[\s\S]*?'empty_route'/.test(store),
  'empty_route solo si stopsResult.status === ok (no ante stops_error)');

// P3 (Codex): reset limpia loadOutcome.
assert(/reset:\s*\(\)\s*=>\s*\{[\s\S]*?loadOutcome:\s*null/.test(store),
  'reset() debe limpiar loadOutcome a null');

// #4 route-start: copy diferenciado + retry
assert(routeStart.includes('describeRouteLoad'), 'route-start usa copy diferenciado');
assert(routeStart.includes('isErrorStatus'), 'route-start distingue error vs no_plan/empty');
assert(/loadPlan\(\{\s*force:\s*true\s*\}\)/.test(routeStart), 'el retry recarga el plan');
// El empty state ya NO hardcodea "No tienes ruta asignada hoy" en el JSX.
assert(!/<Text style=\{styles\.emptyTitle\}>No tienes ruta asignada hoy<\/Text>/.test(routeStart),
  'el empty state no debe hardcodear el título — se deriva del outcome');

// #5 Home reusa el helper puro
assert(home.includes('isStandardNoPlanError'), 'Home reusa isStandardNoPlanError');
assert(!/\/sin plan\/i\.test\(planError\)/.test(home), 'Home no debe duplicar el regex inline');

// El helper nunca clasifica un error como no_plan.
assert(/NUNCA devuelve 'no_plan'/.test(outcome) || /never/i.test(outcome),
  'documentado: classify nunca devuelve no_plan');

console.log('route load error-state wiring tests: ok');
