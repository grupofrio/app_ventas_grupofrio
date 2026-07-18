import assert from 'node:assert/strict';

type Mod = typeof import('../src/services/routeLoadOutcome.ts');

function err(message: string, code?: string): Error {
  const e = new Error(message) as Error & { code?: string };
  if (code) e.code = code;
  return e;
}

// Los fallos técnicos NUNCA se clasifican como no_plan.
function testClassifyNeverNoPlan(m: Mod) {
  const c = m.classifyRouteLoadError;
  assert.equal(c(err('Tiempo de espera agotado después de 10000ms', 'timeout')), 'timeout');
  assert.equal(c(err('cualquier cosa', 'timeout')), 'timeout');
  assert.equal(c(err('Network request failed')), 'network_error');
  assert.equal(c(err('The Internet connection appears to be offline.')), 'network_error');
  assert.equal(c(err('HTTP 503')), 'server_error');
  assert.equal(c(err('Respuesta inválida de my_plan: state no es válido', 'invalid_response')), 'invalid_response');
  assert.equal(c(err('No tienes acceso a este plan')), 'access_denied');
  assert.equal(c(err('boom desconocido')), 'unknown_error');

  // NINGUNO devuelve 'no_plan' — eso solo lo decide found:false (plan===null).
  for (const e of [
    err('Tiempo de espera agotado', 'timeout'),
    err('Network request failed'),
    err('HTTP 500'),
    err('No tienes acceso'),
  ]) {
    assert.notEqual(c(e), 'no_plan');
  }
  console.log('classify never no_plan: ok');
}

function testAccessDenied(m: Mod) {
  assert.equal(m.isAccessDeniedMessage('No tienes acceso a este plan'), true);
  assert.equal(m.isAccessDeniedMessage('El plan fue reasignado'), true);
  assert.equal(m.isAccessDeniedMessage('ok'), false);
  assert.equal(m.isAccessDeniedMessage(null), false);
  // El motivo del backend se conserva en el copy de access_denied.
  const copy = m.describeRouteLoad({ status: 'access_denied', message: 'Plan reasignado a Juan' });
  assert.match(copy.body, /Plan reasignado a Juan/);
  assert.equal(copy.showRetry, true);
  console.log('access denied: ok');
}

function testStandardNoPlan(m: Mod) {
  // Criterio compartido con Home.
  assert.equal(m.isStandardNoPlanError(null), true);
  assert.equal(m.isStandardNoPlanError('Sin plan para hoy'), true);
  assert.equal(m.isStandardNoPlanError('Tiempo de espera agotado'), false);
  assert.equal(m.isStandardNoPlanError('No tienes acceso'), false);
  console.log('standard no_plan: ok');
}

function testIsErrorStatus(m: Mod) {
  assert.equal(m.isErrorStatus('timeout'), true);
  assert.equal(m.isErrorStatus('stops_error'), true);
  assert.equal(m.isErrorStatus('access_denied'), true);
  assert.equal(m.isErrorStatus('no_plan'), false);
  assert.equal(m.isErrorStatus('ok'), false);
  assert.equal(m.isErrorStatus('empty_route'), false);
  console.log('isErrorStatus: ok');
}

function testCopy(m: Mod) {
  // no_plan real → "No tienes ruta asignada hoy"
  assert.equal(m.describeRouteLoad({ status: 'no_plan', message: null }).title, 'No tienes ruta asignada hoy');
  assert.equal(m.describeRouteLoad(null).title, 'No tienes ruta asignada hoy');
  // timeout/red/servidor → "No pudimos cargar tu ruta" (NO "no tienes ruta")
  assert.equal(m.describeRouteLoad({ status: 'timeout', message: null }).title, 'No pudimos cargar tu ruta');
  assert.equal(m.describeRouteLoad({ status: 'network_error', message: null }).title, 'No pudimos cargar tu ruta');
  // stops → "No pudimos cargar las paradas de tu ruta"
  assert.equal(
    m.describeRouteLoad({ status: 'stops_error', message: null }).title,
    'No pudimos cargar las paradas de tu ruta',
  );
  // todos los errores ofrecen retry
  for (const s of ['timeout', 'network_error', 'server_error', 'invalid_response', 'stops_error', 'access_denied'] as const) {
    assert.equal(m.describeRouteLoad({ status: s, message: null }).showRetry, true, `${s} ofrece retry`);
  }
  console.log('copy: ok');
}

async function main() {
  const m = (await import(
    // @ts-ignore -- import.meta solo existe en el runtime de test.
    new URL('../src/services/routeLoadOutcome.ts', import.meta.url).pathname
  )) as Mod;

  testClassifyNeverNoPlan(m);
  testAccessDenied(m);
  testStandardNoPlan(m);
  testIsErrorStatus(m);
  testCopy(m);
  console.log('routeLoadOutcome tests: ok');
}

void main();
