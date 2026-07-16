import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

function read(path) {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

const employeeData = read('src/services/employeeData.ts');
const employeeLogic = read('src/services/employeeDataLogic.ts');
const koldStore = read('src/stores/useKoldStore.ts');

assert.match(
  employeeLogic,
  /\/kold\/insights/,
  'KOLD debe consultar un endpoint de insights agregado y scoped por sesión',
);
assert.match(
  employeeData,
  /getKoldInsights/,
  'el adaptador público debe exponer insights KOLD',
);
assert.match(
  koldStore,
  /getKoldInsights\(partnerIds\)/,
  'cada carga de ruta debe hacer una sola petición KOLD por lote',
);
assert.doesNotMatch(koldStore, /\bkoldRead\b|odooRpc/, 'KOLD no debe conservar fallback RPC/modelos');

console.log('kold secure REST wiring tests: ok');
