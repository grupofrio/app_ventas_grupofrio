/**
 * Runner del refresh autoritativo (contrato final Codex): limpia SOLO tras carga
 * AUTORITATIVA para el warehouse esperado Y limpieza durable confirmada. Guards:
 * sin pending / offline / sin warehouse / in-flight. No infiere éxito por
 * Promise/error null.
 *
 * Cubre escenarios: #5 (markCompleted falla), #6 (global_legacy), #7 (warehouse
 * distinto), #8 (autoritativo→limpia), #9 (online dispara), #10 (offline conserva),
 * #11 (warehouse aparece luego), #12 (dos wakeups→un refresh), #13 (fallo storage
 * sin unhandled rejection).
 */
import assert from 'node:assert/strict';

type RunnerMod = typeof import('../src/services/legacyRefreshRunner.ts');
type Result = import('../src/services/legacyRefreshRunner.ts').InventoryLoadResult;

interface FakeState {
  pending: boolean;
  online: boolean;
  warehouseId: number | null;
  loadResult: Result;
  loadImpl: (() => Promise<Result>) | null;
  markImpl: () => Promise<void>;
  completed: number;
  errors: unknown[];
  nonAuth: Result[];
  loadCalls: number[];
}

function makeDeps(over: Partial<FakeState> = {}) {
  const state: FakeState = {
    pending: true,
    online: true,
    warehouseId: 7,
    loadResult: { ok: true, authoritative: true, warehouseId: 7, source: 'truck_stock' },
    loadImpl: null,
    markImpl: async () => {},
    completed: 0,
    errors: [],
    nonAuth: [],
    loadCalls: [],
    ...over,
  };
  const deps = {
    hasPending: () => state.pending,
    isOnline: () => state.online,
    getWarehouseId: () => state.warehouseId,
    loadAuthoritative: async (wid: number): Promise<Result> => {
      state.loadCalls.push(wid);
      return state.loadImpl ? state.loadImpl() : state.loadResult;
    },
    markCompleted: async () => {
      await state.markImpl();   // puede rechazar (fallo de limpieza durable)
      state.completed += 1;
      state.pending = false;    // el store real limpia memoria tras persistir false
    },
    onError: (e: unknown) => { state.errors.push(e); },
    onNonAuthoritative: (r: Result) => { state.nonAuth.push(r); },
  };
  return { state, deps };
}

async function main() {
  const { createLegacyRefreshRunner } = (await import(
    // @ts-ignore
    new URL('../src/services/legacyRefreshRunner.ts', import.meta.url).pathname
  )) as RunnerMod;

  // baseline: pending=false → no refresca.
  {
    const { state, deps } = makeDeps({ pending: false });
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'skipped_no_pending');
    assert.equal(state.loadCalls.length, 0);
  }

  // #8 / #9 autoritativo + online → refresca y limpia (memoria pending=false).
  {
    const { state, deps } = makeDeps();
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'refreshed');
    assert.deepEqual(state.loadCalls, [7]);
    assert.equal(state.completed, 1);
    assert.equal(state.pending, false);
  }

  // #10 offline → conserva pending, no intenta cargar.
  {
    const { state, deps } = makeDeps({ online: false });
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'skipped_offline');
    assert.equal(state.loadCalls.length, 0);
    assert.equal(state.pending, true);
  }

  // #6 global_legacy → NO autoritativo → no limpia.
  {
    const { state, deps } = makeDeps({
      loadResult: { ok: false, authoritative: false, reason: 'global_legacy_fallback', source: 'global_legacy' },
    });
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'skipped_not_authoritative');
    assert.equal(state.completed, 0);
    assert.equal(state.pending, true);
    assert.equal(state.nonAuth.length, 1);
  }

  // #7a warehouse distinto (ok pero warehouseId != solicitado) → no limpia.
  {
    const { state, deps } = makeDeps({
      loadResult: { ok: true, authoritative: true, warehouseId: 99, source: 'truck_stock' },
    });
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'skipped_not_authoritative');
    assert.equal(state.completed, 0);
    assert.equal(state.pending, true);
  }

  // #7b resultado explícito warehouse_mismatch → no limpia.
  {
    const { state, deps } = makeDeps({
      loadResult: { ok: false, authoritative: false, reason: 'warehouse_mismatch', source: 'stock_quant' },
    });
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'skipped_not_authoritative');
    assert.equal(state.pending, true);
  }

  // #5 / #13 AsyncStorage falla en markCompleted → completion_persist_failed;
  // memoria pending sigue true; NO hay unhandled rejection.
  {
    const { state, deps } = makeDeps({ markImpl: async () => { throw new Error('durable clear failed'); } });
    const r = createLegacyRefreshRunner(deps);
    await assert.doesNotReject(async () => {
      assert.equal(await r.run(), 'completion_persist_failed');
    });
    assert.equal(state.completed, 0);
    assert.equal(state.pending, true);   // se conserva → retry seguro
    assert.equal(state.errors.length, 1);
  }

  // #11 warehouseId aparece DESPUÉS: primero skip, luego intenta al estar disponible.
  {
    const { state, deps } = makeDeps({ warehouseId: null });
    const r = createLegacyRefreshRunner(deps);
    assert.equal(await r.run(), 'skipped_no_warehouse');
    assert.equal(state.pending, true);
    state.warehouseId = 7;               // auth/warehouse disponible
    assert.equal(await r.run(), 'refreshed');
    assert.equal(state.completed, 1);
  }

  // #12 dos wakeups simultáneos → un solo refresh in-flight.
  {
    let release: (r: Result) => void = () => {};
    const gate = new Promise<Result>((res) => { release = res; });
    const { state, deps } = makeDeps({ loadImpl: () => gate });
    const r = createLegacyRefreshRunner(deps);
    const p1 = r.run();
    const p2 = r.run();
    assert.equal(await p2, 'skipped_in_flight');
    assert.equal(state.loadCalls.length, 1, 'una sola carga en vuelo');
    release({ ok: true, authoritative: true, warehouseId: 7, source: 'truck_stock' });
    assert.equal(await p1, 'refreshed');
    assert.equal(state.loadCalls.length, 1);
  }

  console.log('legacy refresh runner tests: ok');
}

void main();
