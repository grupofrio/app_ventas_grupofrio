import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import { isCorteValidatedFlag, mergePlanCorteValidated } from '../src/services/cortePlanState.ts';
import type { GFPlan } from '../src/types/plan.ts';

const root = resolve();

function plan(partial: Partial<GFPlan>): GFPlan {
  return {
    plan_id: 7281,
    name: 'Ruta',
    date: '2026-10-10',
    state: 'in_progress',
    ...partial,
  };
}

test('corte_validated true, 1, and True are already confirmed', () => {
  assert.equal(isCorteValidatedFlag(true), true);
  assert.equal(isCorteValidatedFlag(1), true);
  assert.equal(isCorteValidatedFlag('True'), true);
  assert.equal(isCorteValidatedFlag('true'), true);
  assert.equal(isCorteValidatedFlag(false), false);
  assert.equal(isCorteValidatedFlag('False'), false);
  assert.equal(isCorteValidatedFlag(undefined), false);
});

test('a refresh keeps a stored confirmation when the payload omits the flag', () => {
  const cached = plan({ corte_validated: true });
  const omitted = mergePlanCorteValidated(cached, plan({}));
  assert.equal(omitted.corte_validated, true);

  const serverTrue = mergePlanCorteValidated(plan({}), plan({ corte_validated: 'True' as unknown as boolean }));
  assert.equal(serverTrue.corte_validated, true);

  const serverFalse = mergePlanCorteValidated(cached, plan({ corte_validated: false }));
  assert.equal(serverFalse.corte_validated, false);

  const otherPlan = mergePlanCorteValidated(cached, plan({ plan_id: 8000 }));
  assert.equal(otherPlan.corte_validated, undefined);
});

test('Corte de Caja reads the plan flag instead of asking to confirm again', () => {
  const cashclose = readFileSync(resolve(root, 'app/cashclose.tsx'), 'utf8');
  const routeStore = readFileSync(resolve(root, 'src/stores/useRouteStore.ts'), 'utf8');

  assert.match(cashclose, /isCorteValidatedFlag\(plan\?\.corte_validated\)/);
  assert.match(cashclose, /loadPlan\(\{ force: true \}\)/);
  assert.match(cashclose, /noteCorteValidated\(planId\)/);
  assert.match(cashclose, /Corte confirmado en Odoo/);
  assert.match(cashclose, /corteAlreadyConfirmed \? \([\s\S]*Corte confirmado en Odoo/);
  assert.match(routeStore, /mergePlanCorteValidated\(cachedPlan, plan\)/);
  assert.match(routeStore, /noteCorteValidated: \(planId\)/);
});
