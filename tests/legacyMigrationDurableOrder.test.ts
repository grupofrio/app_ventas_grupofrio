/**
 * Orden DURABLE del retiro de eventos legacy (P1-1). Verifica que la reparación
 * pendiente queda durable ANTES de tocar cola/stock, y que cada fallo de
 * persistencia deja un estado recuperable (nunca "evento desaparecido sin
 * reparación pendiente").
 *
 * Cubre: #1 falla persistir pending → nada tocado; #2 pending antes de retirar;
 * #3 falla persistir cola marcada → sin reversión; #4 falla persistir cola final
 * → reversión hecha pero recuperable; + sin unhandled rejection.
 */
import assert from 'node:assert/strict';

type Mod = typeof import('../src/services/legacyRefillUnloadMigration.ts');

function makeSteps(failAt?: 'pending' | 'marked' | 'final') {
  const calls: string[] = [];
  const steps = {
    persistPendingTrue: async () => {
      calls.push('pending');
      if (failAt === 'pending') throw new Error('persist pending failed');
    },
    markConsumedAndPersist: async () => {
      calls.push('marked');
      if (failAt === 'marked') throw new Error('persist marked failed');
    },
    applyReversal: () => { calls.push('reversal'); },
    removeAndPersist: async () => {
      calls.push('remove');
      if (failAt === 'final') throw new Error('persist final failed');
    },
    onPhaseError: (phase: string) => { calls.push('error:' + phase); },
  };
  return { calls, steps };
}

async function main() {
  const { runDurableLegacyMigration } = (await import(
    // @ts-ignore
    new URL('../src/services/legacyRefillUnloadMigration.ts', import.meta.url).pathname
  )) as Mod;

  // Camino feliz: orden exacto pending → marcado → reversión → retiro.
  {
    const { calls, steps } = makeSteps();
    const res = await runDurableLegacyMigration(steps);
    assert.deepEqual(res, { ok: true, phase: 'completed' });
    assert.deepEqual(calls, ['pending', 'marked', 'reversal', 'remove']);
    // #2 pending se persiste ANTES de retirar la cola.
    assert.ok(calls.indexOf('pending') < calls.indexOf('remove'));
    // reversión ocurre después de marcar+persistir (idempotencia durable).
    assert.ok(calls.indexOf('marked') < calls.indexOf('reversal'));
  }

  // #1 falla persistir pending=true → nada tocado (ni marca, ni reversión, ni retiro).
  {
    const { calls, steps } = makeSteps('pending');
    const res = await runDurableLegacyMigration(steps);
    assert.deepEqual(res, { ok: false, phase: 'pending_persist_failed' });
    assert.deepEqual(calls, ['pending', 'error:persist_pending']);
    assert.ok(!calls.includes('marked'));
    assert.ok(!calls.includes('reversal'));
    assert.ok(!calls.includes('remove'));
  }

  // #3 falla persistir cola marcada → pending YA durable; SIN reversión ni retiro.
  {
    const { calls, steps } = makeSteps('marked');
    const res = await runDurableLegacyMigration(steps);
    assert.deepEqual(res, { ok: false, phase: 'mark_persist_failed' });
    assert.deepEqual(calls, ['pending', 'marked', 'error:persist_marked']);
    assert.ok(!calls.includes('reversal'), 'no se revierte stock si no se pudo marcar');
    assert.ok(!calls.includes('remove'));
  }

  // #4 falla persistir cola final → reversión HECHA, recuperable, pero NO
  // completado: ok=FALSE (no debe tratarse como éxito → sin drain_now).
  {
    const { calls, steps } = makeSteps('final');
    const res = await runDurableLegacyMigration(steps);
    assert.deepEqual(res, { ok: false, phase: 'reverted_removal_unpersisted' });
    assert.deepEqual(calls, ['pending', 'marked', 'reversal', 'remove', 'error:persist_final']);
  }

  // Sin unhandled rejection en ningún fallo de storage.
  for (const failAt of ['pending', 'marked', 'final'] as const) {
    const { steps } = makeSteps(failAt);
    await assert.doesNotReject(async () => { await runDurableLegacyMigration(steps); });
  }

  console.log('legacy migration durable order tests: ok');
}

void main();
