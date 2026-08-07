import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Prueba CONDUCTUAL (P2 Codex #66): un servidor que entrega headers y cuelga
// el body no debe poder bloquear indefinidamente — el timer sigue armado tras
// resolver fetch y aborta el stream al vencer. Se ejercita la semántica con
// un fetch stub (api.ts importa módulos RN, no importable en Node), y el
// wiring del fuente fija que la implementación conserve esa semántica.

const api = readFileSync(resolve(process.cwd(), 'src/services/api.ts'), 'utf8');

// 1) Wiring: el éxito NO desarma el timer; solo el error lo hace.
const fn = api.split('export async function fetchWithTimeout')[1].split('\nasync function')[0];
assert.match(fn, /clearTimeout\(timeoutId\);/, 'el error desarma el timer');
const successPath = fn.split('} catch (error) {')[0];
assert.doesNotMatch(
  successPath,
  /clearTimeout/,
  'resolver fetch NO debe desarmar el timer: el body puede seguir colgado',
);
assert.doesNotMatch(fn, /finally \{/, 'sin finally que desarme el timer al resolver');

// 2) Conducta (misma semántica, reimplementada del fuente verificado arriba):
//    body colgado → el abort del timer rechaza la lectura del body.
async function fetchWithTimeoutSemantics(fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl({ signal: controller.signal });
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

const hangingBodyFetch = ({ signal }) => Promise.resolve({
  ok: true,
  // El body solo termina si el signal aborta (simula stream colgado).
  text: () => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted-by-timeout')));
  }),
});

const response = await fetchWithTimeoutSemantics(hangingBodyFetch, 50);
await assert.rejects(
  () => response.text(),
  /aborted-by-timeout/,
  'el body colgado debe abortar al vencer el timer (no bloqueo infinito)',
);

console.log('fetchWithTimeout behavior tests: ok');
