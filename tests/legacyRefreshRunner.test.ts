/**
 * Runner del refresh autoritativo tras migrar eventos legacy refill/unload.
 * Contrato corregido: la bandera SOLO se limpia tras un refresh EXITOSO; sin
 * warehouse o con fallo se conserva y se reintenta; un solo refresh in-flight.
 *
 * Cubre los 10 escenarios obligatorios (numerados en cada test).
 */
import assert from 'node:assert/strict';

type RunnerMod = typeof import('../src/services/legacyRefreshRunner.ts');
type MigMod = typeof import('../src/services/legacyRefillUnloadMigration.ts');

interface FakeState {
  pending: boolean;
  warehouseId: number | null;
  loadCalls: number[];
  completed: number;
  errors: unknown[];
  loadImpl: () => Promise<unknown>;
}

function makeDeps(over: Partial<FakeState> = {}) {
  const state: FakeState = {
    pending: true,
    warehouseId: 7,
    loadCalls: [],
    completed: 0,
    errors: [],
    loadImpl: async () => {},
    ...over,
  };
  const deps = {
    hasPending: () => state.pending,
    getWarehouseId: () => state.warehouseId,
    loadProducts: async (wid: number) => {
      state.loadCalls.push(wid);
      return state.loadImpl();
    },
    markCompleted: () => {
      state.completed += 1;
      state.pending = false; // el store real limpia el pending al completar
    },
    onError: (e: unknown) => {
      state.errors.push(e);
    },
  };
  return { state, deps };
}

async function main() {
  const { createLegacyRefreshRunner } = (await import(
    // @ts-ignore
    new URL('../src/services/legacyRefreshRunner.ts', import.meta.url).pathname
  )) as RunnerMod;

  // #1 pending=false → no refresca.
  {
    const { state, deps } = makeDeps({ pending: false });
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'skipped_no_pending');
    assert.equal(state.loadCalls.length, 0);
    assert.equal(state.completed, 0);
  }

  // #2 pending=true + warehouseId → refresca y luego limpia.
  {
    const { state, deps } = makeDeps();
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'refreshed');
    assert.deepEqual(state.loadCalls, [7]);
    assert.equal(state.completed, 1);
    assert.equal(state.pending, false);
  }

  // #3 pending=true + sin warehouseId → no limpia (conserva pending).
  {
    const { state, deps } = makeDeps({ warehouseId: null });
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'skipped_no_warehouse');
    assert.equal(state.loadCalls.length, 0);
    assert.equal(state.completed, 0);
    assert.equal(state.pending, true);
  }

  // #4 loadProducts rechaza → no limpia; loggea; conserva pending.
  {
    const { state, deps } = makeDeps({ loadImpl: async () => { throw new Error('net down'); } });
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'failed');
    assert.equal(state.completed, 0);
    assert.equal(state.pending, true);
    assert.equal(state.errors.length, 1);
  }

  // #5 siguiente reconexión tras error → vuelve a intentar.  #6 segundo intento
  // exitoso → limpia.
  {
    const { state, deps } = makeDeps({ loadImpl: async () => { throw new Error('net'); } });
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'failed');       // primer intento falla
    assert.equal(state.pending, true);           // conservado
    state.loadImpl = async () => {};             // la red vuelve
    assert.equal(await r.run(), 'refreshed');    // #5 reintenta
    assert.equal(state.completed, 1);            // #6 limpia una vez
    assert.equal(state.pending, false);
    assert.equal(await r.run(), 'skipped_no_pending'); // ya no reintenta
    assert.equal(state.loadCalls.length, 2);
  }

  // #7 dos wakeups simultáneos → un solo refresh in-flight.
  {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => { release = res; });
    const { state, deps } = makeDeps({ loadImpl: () => gate });
    const r = createLegacyRefreshRunner(deps);
    const p1 = r.run();                 // toma el vuelo (inFlight=true antes del await)
    const p2 = r.run();                 // simultáneo → rebotado
    assert.equal(await p2, 'skipped_in_flight');
    assert.equal(state.loadCalls.length, 1, 'un solo loadProducts en vuelo');
    assert.equal(r.isInFlight(), true);
    release();
    assert.equal(await p1, 'refreshed');
    assert.equal(r.isInFlight(), false);
    assert.equal(state.loadCalls.length, 1);
  }

  // #8 reinicio/rehidratado con refresh pendiente → lo conserva (marca durable
  // restaurada → el runner la respeta y refresca, luego limpia lo durable).
  {
    const durable = { pending: true }; // simula LEGACY_REFRESH_PENDING rehidratado
    const { state, deps } = makeDeps();
    const r = createLegacyRefreshRunner({
      ...deps,
      hasPending: () => durable.pending,
      markCompleted: () => { durable.pending = false; state.completed += 1; },
    });
    assert.equal(durable.pending, true);
    assert.equal(await r.run(), 'refreshed');
    assert.equal(durable.pending, false);
    assert.equal(state.completed, 1);
  }

  // #9 processQueue sigue funcionando aunque el refresh falle: run() NUNCA
  // rechaza (el fallo se contiene en 'failed'), así el fire-and-forget de
  // wakeQueue no rompe el drenaje de la cola.
  {
    const { deps } = makeDeps({ loadImpl: async () => { throw new Error('boom'); } });
    const r = createLegacyRefreshRunner(deps);
    await assert.doesNotReject(async () => {
      assert.equal(await r.run(), 'failed');
    });
  }

  // #10 la migración legacy sigue siendo idempotente (re-plan tras consumir → none).
  {
    const mig = (await import(
      // @ts-ignore
      new URL('../src/services/legacyRefillUnloadMigration.ts', import.meta.url).pathname
    )) as MigMod;
    const item = { id: 'x', type: 'unload', payload: { lines: [{ product_id: 1, qty: 2 }] } };
    assert.equal(mig.planLegacyReversal(item)!.source, 'unload_lines');
    const consumed = { ...item, payload: { ...item.payload, _legacyStockRestored: true } };
    assert.equal(mig.planLegacyReversal(consumed)!.source, 'none');
    const delta = { id: 'y', type: 'unload', payload: { _localStockDelta: [{ product_id: 1, delta: -2 }] } };
    assert.equal(mig.planLegacyReversal(delta)!.source, 'delta');
    const deltaConsumed = { ...delta, payload: { ...delta.payload, _localStockRolledBack: true } };
    assert.equal(mig.planLegacyReversal(deltaConsumed)!.source, 'none');
  }

  console.log('legacy refresh runner tests: ok');
}

void main();
