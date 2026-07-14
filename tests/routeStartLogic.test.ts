/**
 * Tests for routeStartLogic — Sprint A pure helpers.
 *
 * Covers checklist progress derivation, KM validation, and readiness
 * composition (all three steps required to enable "Iniciar ruta").
 */

import assert from 'node:assert/strict';
import type { GFVehicleChecklist, GFVehicleCheck } from '../src/types/routeStart';

interface LogicModule {
  computeChecklistProgress: (header: GFVehicleChecklist | null) => {
    answered: number; total: number; passed: number; requiredPending: number;
  };
  isChecklistComplete: (header: GFVehicleChecklist | null) => boolean;
  isChecklistAnsweredForStart: (header: GFVehicleChecklist | null) => boolean;
  chooseAuthoritativeKm: (input: {
    planKm?: number | null;
    backendKm?: number | null;
    localKm?: number | null;
  }) => number | null;
  isValidKm: (km: unknown) => boolean;
  calculateKmDriven: (initialKm: number | null | undefined, finalKm: number | null | undefined) => number | null;
  formatKm: (n: number | null | undefined) => string;
  findOdometerCheck: (checks: GFVehicleCheck[]) => GFVehicleCheck | null;
  extractOdometerKm: (checks: GFVehicleCheck[]) => number | null;
  computeRouteStartReadiness: (input: {
    checklistComplete: boolean; kmCaptured: boolean; loadAccepted: boolean;
  }) => { checklistDone: boolean; kmCaptured: boolean; loadAccepted: boolean; readyToStart: boolean };
}

function makeCheck(partial: Partial<GFVehicleCheck> & Pick<GFVehicleCheck, 'id' | 'name' | 'check_type'>): GFVehicleCheck {
  return {
    id: partial.id,
    sequence: partial.sequence ?? 10,
    name: partial.name,
    check_type: partial.check_type,
    required: partial.required ?? true,
    blocking_on_fail: partial.blocking_on_fail ?? false,
    passed: partial.passed ?? false,
    answered: partial.answered ?? false,
    not_passed_reason: partial.not_passed_reason ?? '',
    result_numeric: partial.result_numeric ?? null,
  };
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

function testChecklistAnsweredForStart(m: LogicModule) {
  assert.equal(m.isChecklistAnsweredForStart(null), false);
  assert.equal(m.isChecklistAnsweredForStart(makeHeader({ checks_total: 0, checks_answered: 0 })), false);
  assert.equal(m.isChecklistAnsweredForStart(makeHeader({ state: 'completed', checks_total: 3, checks_answered: 1 })), true);
  assert.equal(m.isChecklistAnsweredForStart(makeHeader({ state: 'in_progress', checks_total: 3, checks_answered: 3 })), true);
  assert.equal(m.isChecklistAnsweredForStart(makeHeader({ state: 'in_progress', checks_total: 3, checks_answered: 2 })), false);
}

function testAuthoritativeKm(m: LogicModule) {
  assert.equal(m.chooseAuthoritativeKm({ planKm: 123, backendKm: 456, localKm: 789 }), 123);
  assert.equal(m.chooseAuthoritativeKm({ planKm: null, backendKm: 456, localKm: 789 }), 456);
  assert.equal(m.chooseAuthoritativeKm({ planKm: undefined, backendKm: null, localKm: 789 }), null);
  assert.equal(m.chooseAuthoritativeKm({ planKm: 0, backendKm: 456, localKm: 789 }), 456);
}

function testKmValidation(m: LogicModule) {
  assert.equal(m.isValidKm('123456'), true);
  assert.equal(m.isValidKm(98765), true);
  // Backend rejects km <= 0, so client mirrors that.
  assert.equal(m.isValidKm(0), false);
  assert.equal(m.isValidKm('0'), false);
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

  // missing checklist blocks start: answers are required, regardless of pass/fail.
  r = m.computeRouteStartReadiness({ checklistComplete: false, kmCaptured: true, loadAccepted: true });
  assert.equal(r.readyToStart, false);
  assert.equal(r.checklistDone, false);

  // missing km
  r = m.computeRouteStartReadiness({ checklistComplete: true, kmCaptured: false, loadAccepted: true });
  assert.equal(r.readyToStart, false);

  // all three → ready
  r = m.computeRouteStartReadiness({ checklistComplete: true, kmCaptured: true, loadAccepted: true });
  assert.equal(r.readyToStart, true);
}

function testFindOdometerCheck(m: LogicModule) {
  const checks = [
    makeCheck({ id: 1, name: 'Llantas', check_type: 'yes_no' }),
    makeCheck({ id: 2, name: 'Odómetro salida', check_type: 'numeric', result_numeric: 123456 }),
    makeCheck({ id: 3, name: 'Foto odómetro', check_type: 'photo' }),
  ];
  const found = m.findOdometerCheck(checks);
  assert.equal(found?.id, 2, 'should match the numeric odometer check, not the photo one');

  // No odometer check
  assert.equal(m.findOdometerCheck([makeCheck({ id: 9, name: 'Frenos', check_type: 'yes_no' })]), null);

  // accent-insensitive + "KM" variant
  const kmCheck = [makeCheck({ id: 5, name: 'KM de salida', check_type: 'numeric', result_numeric: 10 })];
  assert.equal(m.findOdometerCheck(kmCheck)?.id, 5);
}

function testExtractOdometerKm(m: LogicModule) {
  // answered with value → rounded
  assert.equal(m.extractOdometerKm([
    makeCheck({ id: 2, name: 'Odómetro salida', check_type: 'numeric', result_numeric: 123456.7 }),
  ]), 123457);

  // no odometer → null
  assert.equal(m.extractOdometerKm([
    makeCheck({ id: 1, name: 'Llantas', check_type: 'yes_no' }),
  ]), null);

  // odometer present but zero / null → null (backend rejects <= 0)
  assert.equal(m.extractOdometerKm([
    makeCheck({ id: 2, name: 'Odómetro salida', check_type: 'numeric', result_numeric: 0 }),
  ]), null);
  assert.equal(m.extractOdometerKm([
    makeCheck({ id: 2, name: 'Odómetro salida', check_type: 'numeric', result_numeric: null }),
  ]), null);
}

function testCalculateKmDriven(m: LogicModule) {
  // final > initial → diff
  assert.equal(m.calculateKmDriven(52300, 52428), 128);
  // final === initial → 0
  assert.equal(m.calculateKmDriven(52300, 52300), 0);
  // final < initial → null (incoherent)
  assert.equal(m.calculateKmDriven(52428, 52300), null);
  // missing initial → null
  assert.equal(m.calculateKmDriven(null, 52428), null);
  assert.equal(m.calculateKmDriven(undefined, 52428), null);
  // missing final → null
  assert.equal(m.calculateKmDriven(52300, null), null);
  // invalid values → null
  assert.equal(m.calculateKmDriven(NaN as unknown as number, 52428), null);
  // rounds the difference
  assert.equal(m.calculateKmDriven(100.2, 250.9), 151);
}

function testFormatKm(m: LogicModule) {
  assert.equal(m.formatKm(52428), '52,428');
  assert.equal(m.formatKm(128), '128');
  assert.equal(m.formatKm(1234567), '1,234,567');
  assert.equal(m.formatKm(0), '0');
  assert.equal(m.formatKm(null), '—');
  assert.equal(m.formatKm(undefined), '—');
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/routeStartLogic.ts', import.meta.url).pathname
  ) as LogicModule;

  testChecklistProgress(m);
  testChecklistComplete(m);
  testChecklistAnsweredForStart(m);
  testAuthoritativeKm(m);
  testKmValidation(m);
  testReadiness(m);
  testFindOdometerCheck(m);
  testExtractOdometerKm(m);
  testCalculateKmDriven(m);
  testFormatKm(m);

  console.log('route start logic tests: ok');
}

void main();
