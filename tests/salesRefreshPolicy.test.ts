import assert from 'node:assert/strict';

async function main() {
  // @ts-ignore -- Node 24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime.
    new URL('../src/services/salesRefreshPolicy.ts', import.meta.url).pathname
  );

  const { shouldRefreshSalesAfterQueueChange, collectSessionCompletedSales } = module;

  // syncing → done: refresca.
  assert.equal(shouldRefreshSalesAfterQueueChange({
    previous: new Map([['op-1', 'syncing']]),
    current: new Map([['op-1', 'done']]),
  }), true);

  // Un done SIN estado previo es un ítem rehidratado de otra sesión: NO
  // refresca (el rehydrate no filtra done; un blob viejo puede resucitarlos).
  assert.equal(shouldRefreshSalesAfterQueueChange({
    previous: new Map(),
    current: new Map([['op-1', 'done']]),
  }), false);

  // pending → error: NO refresca.
  assert.equal(shouldRefreshSalesAfterQueueChange({
    previous: new Map([['op-1', 'pending']]),
    current: new Map([['op-1', 'error']]),
  }), false);

  // done estable (ya observado): NO refresca otra vez.
  assert.equal(shouldRefreshSalesAfterQueueChange({
    previous: new Map([['op-1', 'done']]),
    current: new Map([['op-1', 'done']]),
  }), false);

  // Cambios sin relación (item nuevo pending): NO refresca.
  assert.equal(shouldRefreshSalesAfterQueueChange({
    previous: new Map([['op-1', 'pending']]),
    current: new Map([['op-1', 'pending'], ['op-2', 'pending']]),
  }), false);

  // Cola vacía: NO refresca.
  assert.equal(shouldRefreshSalesAfterQueueChange({
    previous: new Map(),
    current: new Map(),
  }), false);

  // ── collectSessionCompletedSales ──────────────────────────────────────────
  const empty: ReadonlySet<string> = new Set();

  // Transición observada en sesión: entra al set.
  const afterCompletion = collectSessionCompletedSales({
    previous: new Map([['op-1', 'syncing']]),
    current: new Map([['op-1', 'done']]),
  }, empty);
  assert.deepEqual([...afterCompletion], ['op-1']);

  // Done rehidratado (sin previo): NUNCA entra — escenario P1: reinicio con
  // done resucitado + fallo remoto no debe dejar tarjeta fantasma.
  const afterRehydrate = collectSessionCompletedSales({
    previous: new Map(),
    current: new Map([['op-1', 'done']]),
  }, empty);
  assert.equal(afterRehydrate.size, 0);

  // Se conserva mientras siga en la cola; se poda al salir.
  const known: ReadonlySet<string> = new Set(['op-1']);
  const retained = collectSessionCompletedSales({
    previous: new Map([['op-1', 'done']]),
    current: new Map([['op-1', 'done']]),
  }, known);
  assert.deepEqual([...retained], ['op-1']);
  const pruned = collectSessionCompletedSales({
    previous: new Map([['op-1', 'done']]),
    current: new Map(),
  }, known);
  assert.equal(pruned.size, 0);

  // Estabilidad referencial cuando nada cambia (evita renders de más).
  assert.equal(retained, known);

  console.log('sales refresh policy tests: ok');
}

void main();
