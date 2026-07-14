/**
 * Operation gate: Odoo plan state is authoritative, while the locally
 * persisted start facts only describe the matching published plan.
 */
import assert from 'node:assert/strict';

type PlanState = 'draft' | 'confirmed' | 'published' | 'in_progress' | 'closed' | 'reconciled' | 'done';
type OperationMode = 'transaction' | 'close';

interface Input {
  planState: PlanState | null;
  planMatchesReadiness: boolean;
  checklistDone: boolean;
  kmCaptured: boolean;
  loadAccepted: boolean;
  mode?: OperationMode;
}

interface Result {
  canOperate: boolean;
  missing: string[];
  warnings: string[];
  reason: string | null;
}

interface Mod {
  deriveOperationReadiness: (input: Input) => Result;
}

const ready: Input = {
  planState: 'published',
  planMatchesReadiness: true,
  checklistDone: true,
  kmCaptured: true,
  loadAccepted: true,
};

function assertBlocked(result: Result, context: string): void {
  assert.equal(result.canOperate, false, `${context} must be blocked`);
  assert.ok(result.reason && result.reason.length > 0, `${context} must explain the block`);
  assert.deepEqual(result.warnings, [], `${context} must not add unrelated warnings`);
}

function run(m: Mod) {
  // Every server state is explicit in transaction mode.
  const transactionExpectation: Array<[PlanState | null, boolean]> = [
    [null, false],
    ['draft', false],
    ['confirmed', false],
    ['published', false],
    ['in_progress', true],
    ['closed', false],
    ['reconciled', false],
    ['done', false],
  ];
  for (const [planState, expected] of transactionExpectation) {
    const result = m.deriveOperationReadiness({ ...ready, planState, mode: 'transaction' });
    assert.equal(result.canOperate, expected, `transaction mode for ${planState ?? 'null'}`);
    assert.deepEqual(result.warnings, []);
    if (!expected) assert.ok(result.reason);
  }

  // Close mode remains blocked until start, but allows both active and already
  // finalized plans so the close hub can render idempotent/final state.
  const closeExpectation: Array<[PlanState | null, boolean]> = [
    [null, false],
    ['draft', false],
    ['confirmed', false],
    ['published', false],
    ['in_progress', true],
    ['closed', true],
    ['reconciled', true],
    ['done', true],
  ];
  for (const [planState, expected] of closeExpectation) {
    const result = m.deriveOperationReadiness({ ...ready, planState, mode: 'close' });
    assert.equal(result.canOperate, expected, `close mode for ${planState ?? 'null'}`);
    assert.deepEqual(result.warnings, []);
    if (!expected) assert.ok(result.reason);
  }

  for (const planState of [null, 'draft', 'confirmed'] as const) {
    for (const mode of ['transaction', 'close'] as const) {
      assertBlocked(
        m.deriveOperationReadiness({ ...ready, planState, mode }),
        `${planState ?? 'null'} in ${mode} mode`,
      );
    }
  }

  // Alemán case: Odoo already started the plan. Cached phone facts, including
  // a missing KM and a different persisted plan id, cannot revoke that state.
  const aleman = m.deriveOperationReadiness({
    ...ready,
    planState: 'in_progress',
    planMatchesReadiness: false,
    kmCaptured: false,
  });
  assert.deepEqual(aleman, {
    canOperate: true,
    missing: [],
    warnings: [],
    reason: null,
  });

  // A published plan may only use readiness facts persisted for that plan.
  // All-true stale flags from a different plan are equivalent to no facts.
  const stalePublished = m.deriveOperationReadiness({
    ...ready,
    planState: 'published',
    planMatchesReadiness: false,
  });
  assertBlocked(stalePublished, 'published plan with stale readiness');
  assert.deepEqual(stalePublished.missing, [
    'checklist de unidad',
    'KM inicial',
    'aceptar carga',
  ]);
  assert.match(stalePublished.reason ?? '', /checklist de unidad/i);

  const incompletePublished = m.deriveOperationReadiness({
    ...ready,
    planState: 'published',
    checklistDone: false,
    kmCaptured: false,
    loadAccepted: false,
  });
  assertBlocked(incompletePublished, 'published plan with incomplete readiness');
  assert.deepEqual(incompletePublished.missing, [
    'checklist de unidad',
    'KM inicial',
    'aceptar carga',
  ]);

  // Even fully prepared published plans must wait for Odoo to acknowledge the
  // start transition; the sole remaining action is confirming route start.
  const preparedPublished = m.deriveOperationReadiness(ready);
  assertBlocked(preparedPublished, 'prepared published plan');
  assert.deepEqual(preparedPublished.missing, ['confirmar inicio de ruta']);
  assert.match(preparedPublished.reason ?? '', /confirma.*iniciar ruta/i);

  console.log('operation readiness tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/operationReadiness.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
