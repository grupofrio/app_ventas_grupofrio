import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface EmployeeDataModule {
  normalizeEmployeeIncidentCreate: (payload: Record<string, unknown>) => {
    operation_id: string;
    stop_id: number;
    name: string;
    incident_type: 'operation' | 'customer' | 'quality' | 'collection' | 'vehicle';
    severity: 'low' | 'medium' | 'high';
    requires_follow_up: boolean;
  };
  normalizeEmployeeDateQuery: (payload?: Record<string, unknown>) => { date?: string };
}

const REPO_ROOT = resolve(import.meta.dirname, '..');

function testIncidentCreatePayloadIsBounded(module: EmployeeDataModule) {
  const payload = module.normalizeEmployeeIncidentCreate({
    operation_id: '1f7d91d2-5c32-4e52-86ae-077bea24805a',
    stop_id: 42,
    name: '  Cliente cerrado al llegar  ',
    incident_type: 'customer',
    severity: 'high',
    requires_follow_up: true,
  });

  assert.deepEqual(payload, {
    operation_id: '1f7d91d2-5c32-4e52-86ae-077bea24805a',
    stop_id: 42,
    name: 'Cliente cerrado al llegar',
    incident_type: 'customer',
    severity: 'high',
    requires_follow_up: true,
  });
}

function testIncidentCreateRejectsNonV4AndAuthoritySelectors(module: EmployeeDataModule) {
  const valid = {
    operation_id: '1f7d91d2-5c32-4e52-86ae-077bea24805a',
    stop_id: 42,
    name: 'Cliente cerrado al llegar',
    incident_type: 'customer',
    severity: 'high',
  };

  assert.throws(
    () => module.normalizeEmployeeIncidentCreate({ ...valid, operation_id: 'not-a-uuid' }),
    /operation_id/i,
  );
  assert.throws(
    () => module.normalizeEmployeeIncidentCreate({ ...valid, stop_id: 0 }),
    /stop_id/i,
  );
  assert.throws(
    () => module.normalizeEmployeeIncidentCreate({ ...valid, employee_id: 8 }),
    /permitido/i,
  );
  assert.throws(
    () => module.normalizeEmployeeIncidentCreate({ ...valid, company_id: 3 }),
    /permitido/i,
  );
  assert.throws(
    () => module.normalizeEmployeeIncidentCreate({ ...valid, name: 'x'.repeat(161) }),
    /name/i,
  );
}

function testDateQueriesAreAllowlisted(module: EmployeeDataModule) {
  assert.deepEqual(module.normalizeEmployeeDateQuery(), {});
  assert.deepEqual(module.normalizeEmployeeDateQuery({ date: '2026-08-14' }), { date: '2026-08-14' });
  assert.throws(() => module.normalizeEmployeeDateQuery({ employee_id: 8 }), /permitido/i);
  assert.throws(() => module.normalizeEmployeeDateQuery({ date: '14/08/2026' }), /fecha/i);
}

function testAdapterUsesOnlyBoundedEmployeeRestEndpoints() {
  const source = readFileSync(resolve(REPO_ROOT, 'src/services/employeeData.ts'), 'utf8');
  assert.match(source, /import\s*\{\s*postRest\s*\}\s*from ['"]\.\/api['"]/);
  assert.match(source, /EMPLOYEE_API_BASE = ['"]\/gf\/logistics\/api\/employee['"]/);
  assert.match(source, /\$\{EMPLOYEE_API_BASE\}\/incidents\/create/);
  assert.match(source, /\$\{EMPLOYEE_API_BASE\}\/incidents\/list/);
  assert.match(source, /\$\{EMPLOYEE_API_BASE\}\/kold\/insights/);
  assert.doesNotMatch(source, /odooRpc|odooSession|call_kw|execute_kw|get_records|api\/create_update/);
}

async function main() {
  const module = await import(
    // @ts-ignore -- Node's strip-types loader resolves this absolute file path.
    new URL('../src/services/employeeDataLogic.ts', import.meta.url).pathname
  ) as EmployeeDataModule;

  testIncidentCreatePayloadIsBounded(module);
  testIncidentCreateRejectsNonV4AndAuthoritySelectors(module);
  testDateQueriesAreAllowlisted(module);
  testAdapterUsesOnlyBoundedEmployeeRestEndpoints();
  console.log('employee data tests: ok');
}

void main();
