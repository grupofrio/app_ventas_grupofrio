/**
 * P1: detección de sesión expirada para ofrecer re-login.
 */
import assert from 'node:assert/strict';

interface Mod {
  isSessionExpiredError: (err: unknown) => boolean;
}

function run(m: Mod) {
  // code session_expired (hardening P0)
  const e1 = Object.assign(new Error('whatever'), { code: 'session_expired' });
  assert.equal(m.isSessionExpiredError(e1), true);

  // message variants
  assert.equal(m.isSessionExpiredError(new Error('Sesión expirada. Vuelve a iniciar sesión.')), true);
  assert.equal(m.isSessionExpiredError(new Error('HTTP 401')), true);
  assert.equal(m.isSessionExpiredError(new Error('Unauthorized')), true);
  assert.equal(m.isSessionExpiredError('session expired'), true);

  // not session errors
  assert.equal(m.isSessionExpiredError(new Error('HTTP 500')), false);
  assert.equal(m.isSessionExpiredError(new Error('Network request failed')), false);
  assert.equal(m.isSessionExpiredError(null), false);
  assert.equal(m.isSessionExpiredError(undefined), false);
  assert.equal(m.isSessionExpiredError({}), false);

  console.log('session error tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/sessionError.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
