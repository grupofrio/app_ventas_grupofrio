/**
 * Handler ÚNICO del resultado de migración durable (P2 Codex):
 *  - defer del lote (con backoff) en TODA fase no-completada, también en rehydrate;
 *  - wake del runner DESPUÉS de dejar pending durable (cierra la carrera
 *    runner-preventivo/dispatcher).
 *
 * Cubre: rehydrate deferred (defer+wake, sin drain_now, sin backend) y la carrera
 * dispatcher/runner (segundo intento ve pending=true y refresca exactamente una vez).
 */
import assert from 'node:assert/strict';

type MigMod = typeof import('../src/services/legacyRefillUnloadMigration.ts');
type RunnerMod = typeof import('../src/services/legacyRefreshRunner.ts');
type Result = import('../src/services/legacyRefreshRunner.ts').InventoryLoadResult;

function makeEffects() {
  const calls = { defer: 0, notify: 0 };
  return {
    calls,
    effects: {
      defer: () => { calls.defer += 1; },
      notifyRefreshPending: () => { calls.notify += 1; },
    },
  };
}

async function main() {
  const mig = (await import(
    // @ts-ignore
    new URL('../src/services/legacyRefillUnloadMigration.ts', import.meta.url).pathname
  )) as MigMod;
  const runnerMod = (await import(
    // @ts-ignore
    new URL('../src/services/legacyRefreshRunner.ts', import.meta.url).pathname
  )) as RunnerMod;
  const { handleDurableMigrationResult } = mig;
  const { createLegacyRefreshRunner } = runnerMod;

  // completed → wake (pending sigue true hasta refresh), NO defer, status completed.
  {
    const { calls, effects } = makeEffects();
    const status = handleDurableMigrationResult({ ok: true, phase: 'completed' }, effects);
    assert.equal(status, 'completed');
    assert.equal(calls.defer, 0);
    assert.equal(calls.notify, 1);
  }

  // reverted_removal_unpersisted → DEFER (backoff) + wake (pending durable).
  {
    const { calls, effects } = makeEffects();
    const status = handleDurableMigrationResult(
      { ok: false, phase: 'reverted_removal_unpersisted' }, effects);
    assert.equal(status, 'deferred');
    assert.equal(calls.defer, 1);   // difiere aunque venga de rehydrate
    assert.equal(calls.notify, 1);  // pending durable → despierta runner
  }

  // mark_persist_failed → defer + wake (pending SÍ quedó durable en el paso 1).
  {
    const { calls, effects } = makeEffects();
    const status = handleDurableMigrationResult({ ok: false, phase: 'mark_persist_failed' }, effects);
    assert.equal(status, 'deferred');
    assert.equal(calls.defer, 1);
    assert.equal(calls.notify, 1);
  }

  // pending_persist_failed → defer, pero SIN wake (pending NO quedó durable).
  {
    const { calls, effects } = makeEffects();
    const status = handleDurableMigrationResult({ ok: false, phase: 'pending_persist_failed' }, effects);
    assert.equal(status, 'deferred');
    assert.equal(calls.defer, 1);
    assert.equal(calls.notify, 0);  // no despierta si no hay pending durable
  }

  // ── Carrera dispatcher/runner: el wake posterior cierra la ventana ──────────
  {
    const state = { pending: false, online: true, warehouseId: 7, loads: 0 };
    const runner = createLegacyRefreshRunner({
      hasPending: () => state.pending,
      isOnline: () => state.online,
      getWarehouseId: () => state.warehouseId,
      loadAuthoritative: async (wid: number): Promise<Result> => {
        state.loads += 1;
        return { ok: true, authoritative: true, warehouseId: wid, source: 'truck_stock' };
      },
      markCompleted: async () => { state.pending = false; },
    });

    // 1-3) intento PREVENTIVO (wakeQueue) ve pending=false.
    assert.equal(await runner.run(), 'skipped_no_pending');
    assert.equal(state.loads, 0);

    // 4) el dispatcher migra y fija pending=true; 5) el handler NOTIFICA → wake.
    state.pending = true; // durableMigrateLegacy dejó pending durable+memoria
    let woke = 0;
    handleDurableMigrationResult({ ok: true, phase: 'completed' }, {
      defer: () => {},
      notifyRefreshPending: () => { woke += 1; void runner.run().then((o) => { lastOutcome = o; }); },
    });
    let lastOutcome: string | undefined;
    // El wake dispara el segundo intento; esperamos su resolución.
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(woke, 1);
    // 6-7) el segundo intento ve pending=true y refresca EXACTAMENTE una vez.
    assert.equal(state.loads, 1);
    assert.equal(state.pending, false); // limpiado tras refresco
  }

  // Guardas del runner ante el wake: sin warehouse / offline conservan pending.
  {
    const state = { pending: true, online: true, warehouseId: null as number | null, loads: 0 };
    const runner = createLegacyRefreshRunner({
      hasPending: () => state.pending,
      isOnline: () => state.online,
      getWarehouseId: () => state.warehouseId,
      loadAuthoritative: async (wid: number): Promise<Result> => {
        state.loads += 1;
        return { ok: true, authoritative: true, warehouseId: wid, source: 'truck_stock' };
      },
      markCompleted: async () => { state.pending = false; },
    });
    assert.equal(await runner.run(), 'skipped_no_warehouse'); // #13 sin warehouse conserva
    assert.equal(state.pending, true);
    state.online = false; state.warehouseId = 7;
    assert.equal(await runner.run(), 'skipped_offline');       // #14 offline conserva
    assert.equal(state.pending, true);
    assert.equal(state.loads, 0);
  }

  console.log('legacy migration result handling tests: ok');
}

void main();
