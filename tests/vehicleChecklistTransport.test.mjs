import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/vehicleChecklist.ts', import.meta.url), 'utf8');

assert.doesNotMatch(
  source,
  /postRestGet|getRest/,
  'vehicle checklist endpoints are Odoo type=json routes; use POST payloads, not HTTP GET',
);

assert.match(
  source,
  /postRest<unknown>\(`\$\{PWA_RUTA\}\/vehicle-checklist`,\s*\{\s*route_plan_id: routePlanId,\s*\}/s,
  'getVehicleChecklist must read by POSTing route_plan_id',
);

assert.match(
  source,
  /postRest<unknown>\(`\$\{PWA_RUTA\}\/vehicle-checks`,\s*\{\s*checklist_id: checklistId,\s*\}/s,
  'getVehicleChecks must read by POSTing checklist_id',
);

console.log('vehicle checklist transport tests: ok');
