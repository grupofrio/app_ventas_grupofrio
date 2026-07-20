/**
 * P1 — un fallo de persistencia final (legacy diferido) NUNCA dispara drain_now:
 * `decidePostCycleActionAfterCycle({hadDeferredStorageFailure:true})` fuerza
 * backoff (schedule_wake/idle), imposibilitando el bucle storage-falla→drain_now.
 * También verifica que `reverted_removal_unpersisted` es ok:false.
 *
 * P2 — `shouldWakeOnWarehouseTransition`: dispara el refresh pendiente cuando
 * aparece/cambia un warehouse válido, nunca sin pending ni con el mismo warehouse.
 */
import assert from 'node:assert/strict';

type WakeMod = typeof import('../src/services/syncWakeup.ts');
type MigMod = typeof import('../src/services/legacyRefillUnloadMigration.ts');

const NOW = 1_700_000_000_000;
const alwaysDeps = () => true;

async function main() {
  const wake = (await import(
    // @ts-ignore
    new URL('../src/services/syncWakeup.ts', import.meta.url).pathname
  )) as WakeMod;
  const mig = (await import(
    // @ts-ignore
    new URL('../src/services/legacyRefillUnloadMigration.ts', import.meta.url).pathname
  )) as MigMod;

  const { decidePostCycleActionAfterCycle, shouldWakeOnWarehouseTransition } = wake;

  // ── P1: no drain_now cuando hubo diferido ──────────────────────────────────

  // El ítem diferido queda en 'error' + backoff futuro (como lo deja
  // deferLegacyMigrationItem): retries 0 (nunca dead), next_retry_at futuro.
  const deferred = { id: 'lg', status: 'error' as const, retries: 0, next_retry_at: NOW + 8000, dependsOn: undefined };

  // (#7) con la señal de diferido, aunque el ítem "parezca" trabajo, NO drain_now.
  assert.equal(
    decidePostCycleActionAfterCycle({
      hadUnhandledCycleError: false,
      hadDeferredStorageFailure: true,
      queue: [deferred],
      now: NOW,
      maxRetries: 3,
      depsSatisfied: alwaysDeps,
    }),
    'schedule_wake',
    'diferido → backoff, jamás drain_now',
  );

  // Incluso si ADEMÁS hay un pending fresco (que normalmente daría drain_now),
  // la señal de diferido fuerza backoff → imposible el bucle de redrenaje.
  const freshPending = { id: 'p', status: 'pending' as const, retries: 0, next_retry_at: null, dependsOn: undefined };
  assert.equal(
    decidePostCycleActionAfterCycle({
      hadUnhandledCycleError: false,
      hadDeferredStorageFailure: true,
      queue: [deferred, freshPending],
      now: NOW,
      maxRetries: 3,
      depsSatisfied: alwaysDeps,
    }),
    'schedule_wake',
    'con diferido, ni un pending fresco fuerza drain_now',
  );

  // Baseline (sin diferido): un pending fresco SÍ da drain_now — no rompimos la vía normal.
  assert.equal(
    decidePostCycleActionAfterCycle({
      hadUnhandledCycleError: false,
      queue: [freshPending],
      now: NOW,
      maxRetries: 3,
      depsSatisfied: alwaysDeps,
    }),
    'drain_now',
    'sin diferido el drain_now normal se conserva',
  );

  // (#5) reverted_removal_unpersisted NO es éxito.
  const steps = {
    persistPendingTrue: async () => {},
    markConsumedAndPersist: async () => {},
    applyReversal: () => {},
    removeAndPersist: async () => { throw new Error('final persist fail'); },
    onPhaseError: () => {},
  };
  const res = await mig.runDurableLegacyMigration(steps);
  assert.deepEqual(res, { ok: false, phase: 'reverted_removal_unpersisted' });

  // ── P2: transición de warehouse ────────────────────────────────────────────
  // #1 pending + null → null: no dispara.
  assert.equal(shouldWakeOnWarehouseTransition(null, null, true), false);
  // #2 null → 7 con pending: dispara.
  assert.equal(shouldWakeOnWarehouseTransition(null, 7, true), true);
  // 0/undefined → 7 también cuentan como "apareció".
  assert.equal(shouldWakeOnWarehouseTransition(0, 7, true), true);
  assert.equal(shouldWakeOnWarehouseTransition(undefined, 7, true), true);
  // #4 7 → 7: no duplica.
  assert.equal(shouldWakeOnWarehouseTransition(7, 7, true), false);
  // #7 cambio a OTRO válido (7 → 9): intenta (el runner revalida coincidencia).
  assert.equal(shouldWakeOnWarehouseTransition(7, 9, true), true);
  // válido → inválido (logout / 0): no dispara.
  assert.equal(shouldWakeOnWarehouseTransition(7, 0, true), false);
  assert.equal(shouldWakeOnWarehouseTransition(7, null, true), false);
  // #9 sin pending: nunca dispara (no carga inventario innecesariamente).
  assert.equal(shouldWakeOnWarehouseTransition(null, 7, false), false);
  assert.equal(shouldWakeOnWarehouseTransition(7, 9, false), false);

  console.log('legacy deferred + warehouse wake tests: ok');
}

void main();
