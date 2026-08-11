import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

const api = readFileSync(resolve(REPO_ROOT, 'src/services/api.ts'), 'utf8');
const odooDatabase = readFileSync(resolve(REPO_ROOT, 'src/services/odooDatabase.ts'), 'utf8');
const authStore = readFileSync(resolve(REPO_ROOT, 'src/stores/useAuthStore.ts'), 'utf8');
const giftScreen = readFileSync(resolve(REPO_ROOT, 'app/gift/[stopId].tsx'), 'utf8');

function main() {
  // Pendiente auditoría julio: login y JSON-RPC corrían con fetch SIN timeout.
  assert.match(api, /export async function fetchWithTimeout\(/, 'fetchWithTimeout debe ser reutilizable');
  assert.match(api, /export const AUTH_TIMEOUT_MS = 15_000;/, 'timeout de auth definido');

  // Cero fetch crudos en las rutas de sesión/login/DB.
  assert.match(
    odooDatabase,
    /controller\.abort\(\), DB_LIST_TIMEOUT_MS\)/,
    'la resolución de DB aborta por timeout (AbortController local: el módulo sigue puro)',
  );
  assert.doesNotMatch(authStore, /await fetch\(/, 'el login no debe usar fetch sin timeout');

  assert.match(
    authStore,
    /\}, AUTH_TIMEOUT_MS\);/,
    'el login usa el timeout de auth (15s), no cuelga indefinido',
  );
  // Regalo: la ubicación móvil cae a Auth cuando el plan no la trae.
  assert.match(
    giftScreen,
    /plan\?\.mobile_location_id \?\? authMobileLocationId \?\? null/,
    'el regalo debe usar la ubicación de Auth como fallback del plan',
  );

  console.log('network timeouts wiring tests: ok');
}

main();
