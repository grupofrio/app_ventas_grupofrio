/**
 * Tests for routeStartLogic — Sprint A pure helpers.
 *
 * Covers checklist progress derivation, KM validation, and readiness
 * composition (all three steps required to enable "Iniciar ruta").
 */

import assert from 'node:assert/strict';
import type { GFVehicleChecklist } from '../src/types/routeStart';

interface LogicModule {
  computeChecklistProgress: (header: GFVehicleChecklist | null) => {
    answered: number; total: number; passed: number; requiredPending: number;
  };
  isChecklistComplete: (header: GFVehicleChecklist | null) => boolean;
  isValidKm: (km: unknown) => boolean;
  computeRouteStartReadiness: (input: {
    checklistComplete: boolean; kmCaptured: boolean; loadAccepted: boolean;
  }) => { checklistDone: boolean; kmCaptured: boolean; loadAccepted: boolean; readyToStart: boolean };
}

function makeHeader(partial: Partial<GFVehicleChecklist>): GFVehicleChecklist {
  return {
    id: partial.id ?? 1,
    route_plan_id: partial.route_plan_id ?? 99,
    state: partial.state ?? 'in_progress',
    vehicle_id: partial.vehicle_id ?? 5,
    vehicle_name: partial.vehicle_name ?? 'Camioneta 5',
    checks_total: partial.checks_total ?? 0,
    checks_answered: partial.checks_answered ?? 0,
    checks_passed: partial.checks_passed ?? 0,
    checks_required_pending: partial.checks_required_pending ?? 0,
    notes: partial.notes ?? '',
  };
}

function testChecklistProgress(m: LogicModule) {
  assert.deepEqual(m.computeChecklistProgress(null), { answered: 0, total: 0, passed: 0, requiredPending: 0 });
  const h = makeHeader({ checks_total: 10, checks_answered: 7, checks_passed: 6, checks_required_pending: 2 });
  assert.deepEqual(m.computeChecklistProgress(h), { answered: 7, total: 10, passed: 6, requiredPending: 2 });
}

function testChecklistComplete(m: LogicModule) {
  assert.equal(m.isChecklistComplete(null), false);
  assert.equal(m.isChecklistComplete(makeHeader({ state: 'draft' })), false);
  assert.equal(m.isChecklistComplete(makeHeader({ state: 'in_progress' })), false);
  assert.equal(m.isChecklistComplete(makeHeader({ state: 'cancelled' })), false);
  assert.equal(m.isChecklistComplete(makeHeader({ state: 'completed' })), true);
}

function testKmValidation(m: LogicModule) {
  assert.equal(m.isValidKm('123456'), true);
  assert.equal(m.isValidKm(0), true);
  assert.equal(m.isValidKm('0'), true);
  assert.equal(m.isValidKm(98765), true);
  assert.equal(m.isValidKm(''), false);
  assert.equal(m.isValidKm('abc'), false);
  assert.equal(m.isValidKm(-5), false);
  assert.equal(m.isValidKm(null), false);
  assert.equal(m.isValidKm(undefined), false);
}

function testReadiness(m: LogicModule) {
  // all false
  let r = m.computeRouteStartReadiness({ checklistComplete: false, kmCaptured: false, loadAccepted: false });
  assert.equal(r.readyToStart, false);

  // two of three
  r = m.computeRouteStartReadiness({ checklistComplete: true, kmCaptured: true, loadAccepted: false });
  assert.equal(r.readyToStart, false);
  assert.equal(r.checklistDone, true);
  assert.equal(r.loadAccepted, false);

  // missing checklist
  r = m.computeRouteStartReadiness({ checklistComplete: false, kmCaptured: true, loadAccepted: true });
  assert.equal(r.readyToStart, false);

  // missing km
  r = m.computeRouteStartReadiness({ checklistComplete: true, kmCaptured: false, loadAccepted: true });
  assert.equal(r.readyToStart, false);

  // all three → ready
  r = m.computeRouteStartReadiness({ checklistComplete: true, kmCaptured: true, loadAccepted: true });
  assert.equal(r.readyToStart, true);
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/routeStartLogic.ts', import.meta.url).pathname
  ) as LogicModule;

  testChecklistProgress(m);
  testChecklistComplete(m);
  testKmValidation(m);
  testReadiness(m);

  console.log('route start logic tests: ok');
}

void main();
