import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

function testIncidentServiceUsesScopedAdapterAndOwnsNoAuthority() {
  const source = read('src/services/routeIncidents.ts');
  assert.match(source, /from ['"]\.\/employeeData['"]/);
  assert.match(source, /createEmployeeIncident\(/);
  assert.match(source, /listEmployeeIncidents\(/);
  assert.match(source, /createUuidV4\(/);
  assert.doesNotMatch(source, /odooRpc|odooRead|odooWrite|employeeId|companyId|employee_id|company_id/);
}

function testKoldStoreUsesScopedInsightsAndNeverReadsOdooModels() {
  const source = read('src/stores/useKoldStore.ts');
  assert.match(source, /from ['"]\.\.\/services\/employeeData['"]/);
  assert.match(source, /getEmployeeKoldInsights\(/);
  assert.match(source, /set\(\{ error: msg, isLoading: false \}\);\s*throw error;/);
  assert.doesNotMatch(source, /odooRpc|koldRead|kold\.customer\.score|kold\.demand\.forecast/);
}

function testIncidentScreensNoLongerSupplyEmployeeOrCompanyAuthority() {
  const incidentScreen = read('app/incident.tsx');
  const checkout = read('app/checkout/[stopId].tsx');
  assert.doesNotMatch(incidentScreen, /createIncident\(built\.payload,\s*employeeId,\s*companyId\)/);
  assert.doesNotMatch(checkout, /createIncident\([\s\S]*?\),\s*employeeId,\s*companyId\)/);
}

testIncidentServiceUsesScopedAdapterAndOwnsNoAuthority();
testKoldStoreUsesScopedInsightsAndNeverReadsOdooModels();
testIncidentScreensNoLongerSupplyEmployeeOrCompanyAuthority();
console.log('secure incidents and Kold wiring tests: ok');
