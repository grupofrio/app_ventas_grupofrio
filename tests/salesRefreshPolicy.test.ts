import assert from 'node:assert/strict';

async function main() {
  // @ts-ignore -- Node 24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime.
    new URL('../src/services/salesRefreshPolicy.ts', import.meta.url).pathname
  );

  const { shouldRefreshSalesAfterQueueChange } = module;

  // syncing → done: refresca.
  assert.equal(shouldRefreshSalesAfterQueueChange({
    previous: new Map([['op-1', 'syncing']]),
    current: new Map([['op-1', 'done']]),
  }), true);

  // Un done recién observado (sin estado previo) también refresca.
  assert.equal(shouldRefreshSalesAfterQueueChange({
    previous: new Map(),
    current: new Map([['op-1', 'done']]),
  }), true);

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

  console.log('sales refresh policy tests: ok');
}

void main();
