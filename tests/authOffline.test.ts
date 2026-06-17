/**
 * Sesión offline: reusar sesión guardada válida; bloquear (forzar re-login) si
 * no hay sesión o está incompleta; aviso offline honesto en login.
 */
import assert from 'node:assert/strict';

interface Mod {
  isRestorableSession: (saved: unknown) => { ok: boolean; reason: string };
  describeLoginOfflineNotice: (isOnline: boolean) => string | null;
}

function run(m: Mod) {
  // Sesión guardada válida → restaurable (entrar offline OK).
  const valid = m.isRestorableSession({ employeeId: 42, warehouseId: 7, employeeName: 'Ana' });
  assert.equal(valid.ok, true);
  assert.equal(valid.reason, 'ok');

  // Sin sesión → bloquea (forzar login).
  assert.equal(m.isRestorableSession(null).ok, false);
  assert.equal(m.isRestorableSession(null).reason, 'no_session');
  assert.equal(m.isRestorableSession(undefined).ok, false);
  assert.equal(m.isRestorableSession('x').ok, false);

  // Sesión incompleta (sin warehouse o sin employee) → bloquea.
  assert.equal(m.isRestorableSession({ employeeId: 42 }).reason, 'incomplete');
  assert.equal(m.isRestorableSession({ warehouseId: 7 }).reason, 'incomplete');
  assert.equal(m.isRestorableSession({ employeeId: 0, warehouseId: 7 }).ok, false, 'id 0 inválido');
  assert.equal(m.isRestorableSession({ employeeId: 42, warehouseId: 0 }).ok, false);

  // Aviso offline: solo sin conexión, honesto (login nuevo requiere internet;
  // sesión previa se restaura al abrir la app).
  assert.equal(m.describeLoginOfflineNotice(true), null);
  const notice = m.describeLoginOfflineNotice(false) ?? '';
  assert.match(notice, /sin conexión/i);
  assert.match(notice, /internet/i);
  assert.match(notice, /restaura/i);

  console.log('auth offline tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta solo en runtime de test.
    new URL('../src/services/authOffline.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
