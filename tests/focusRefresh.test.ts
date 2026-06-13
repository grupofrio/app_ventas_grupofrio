/**
 * Perf Fase 1C: guard de refetch-on-focus. Evita re-pedir datos recientes al
 * recuperar foco; siempre carga si nunca se cargó o si ya pasó el intervalo.
 */
import assert from 'node:assert/strict';

interface Mod {
  shouldRefetchOnFocus: (lastSync: number | null | undefined, now: number, minIntervalMs?: number) => boolean;
}

function run(m: Mod) {
  const NOW = 1_000_000;

  // Nunca cargado → siempre refetch.
  assert.equal(m.shouldRefetchOnFocus(null, NOW), true);
  assert.equal(m.shouldRefetchOnFocus(undefined, NOW), true);

  // Cargado hace poco (<8s default) → NO refetch (evita el focus redundante).
  assert.equal(m.shouldRefetchOnFocus(NOW - 1_000, NOW), false);
  assert.equal(m.shouldRefetchOnFocus(NOW - 7_999, NOW), false);

  // Cargado hace >= intervalo → refetch (refrescar).
  assert.equal(m.shouldRefetchOnFocus(NOW - 8_000, NOW), true);
  assert.equal(m.shouldRefetchOnFocus(NOW - 60_000, NOW), true);

  // Intervalo custom.
  assert.equal(m.shouldRefetchOnFocus(NOW - 3_000, NOW, 5_000), false);
  assert.equal(m.shouldRefetchOnFocus(NOW - 5_000, NOW, 5_000), true);

  console.log('focus refresh tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/focusRefresh.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
