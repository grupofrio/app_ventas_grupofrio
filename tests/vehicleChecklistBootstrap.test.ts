import assert from 'node:assert/strict';
import type { GFVehicleChecklist } from '../src/types/routeStart';

interface Mod {
  getVehicleChecklistBootstrapAction: (
    header: GFVehicleChecklist | null,
  ) => 'create' | 'init' | 'read_checks';
  buildYesNoVehicleCheckAnswer: (input: {
    value: boolean;
    expected?: boolean;
    reason?: string;
  }) => { result_bool: boolean; not_passed_reason?: string };
}

function makeHeader(state: GFVehicleChecklist['state']): GFVehicleChecklist {
  return {
    id: 10,
    route_plan_id: 99,
    state,
    vehicle_id: 1,
    vehicle_name: 'Unidad',
    checks_total: 3,
    checks_answered: 0,
    checks_passed: 0,
    checks_required_pending: 3,
    notes: '',
  };
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/vehicleChecklistLogic.ts', import.meta.url).pathname
  ) as Mod;

  assert.equal(m.getVehicleChecklistBootstrapAction(null), 'create');
  assert.equal(m.getVehicleChecklistBootstrapAction(makeHeader('draft')), 'init');
  assert.equal(m.getVehicleChecklistBootstrapAction(makeHeader('in_progress')), 'read_checks');
  assert.equal(m.getVehicleChecklistBootstrapAction(makeHeader('completed')), 'read_checks');

  assert.deepEqual(
    m.buildYesNoVehicleCheckAnswer({ value: true, expected: true }),
    { result_bool: true },
  );
  assert.deepEqual(
    m.buildYesNoVehicleCheckAnswer({ value: false, expected: true, reason: 'Llanta baja' }),
    { result_bool: false, not_passed_reason: 'Llanta baja' },
  );
  assert.deepEqual(
    m.buildYesNoVehicleCheckAnswer({ value: false, expected: true }),
    { result_bool: false, not_passed_reason: 'Respuesta registrada en checklist de inicio.' },
  );

  console.log('vehicle checklist bootstrap tests: ok');
}

void main();
