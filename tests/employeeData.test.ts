import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const logicPath = resolve(REPO_ROOT, 'src/services/employeeDataLogic.ts');

type RestPost = (
  url: string,
  data: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<unknown>;

interface EmployeeDataLogicModule {
  createEmployeeDataClient: (input: {
    postRest: RestPost;
    readTimeoutMs: number;
  }) => {
    searchEmployeeDirectory: (query: string, limit?: number) => Promise<{ customers: unknown[]; leads: unknown[] }>;
    getEmployeeScopedLoyalty: (partnerId: number) => Promise<Record<string, unknown> | null>;
    updateEmployeeScopedContact: (partnerId: number, values: Record<string, string | false>) => Promise<Record<string, unknown> | null>;
  };
  unwrapEmployeeEnvelope: <T>(result: unknown) => T | null;
}

type Call = {
  url: string;
  data: Record<string, unknown>;
  options: { timeoutMs?: number } | undefined;
};

function createPostSpy(responses: unknown[]) {
  const calls: Call[] = [];
  const postRest: RestPost = async (url, data, options) => {
    calls.push({ url, data, options });
    return responses.shift();
  };
  return { calls, postRest };
}

async function loadLogic(): Promise<EmployeeDataLogicModule> {
  assert.equal(existsSync(logicPath), true, 'el cliente ejecutable de datos de empleado debe existir');
  return await import(logicPath) as EmployeeDataLogicModule;
}

async function testDirectoryExecutesScopedRequest(module: EmployeeDataLogicModule) {
  const spy = createPostSpy([{
    data: {
      customers: [{ id: 10, name: 'Cliente' }],
      leads: [{ id: 20, name: 'Lead' }],
    },
  }]);
  const client = module.createEmployeeDataClient({ postRest: spy.postRest, readTimeoutMs: 7_777 });

  const result = await client.searchEmployeeDirectory('  Cliente  ', 99);

  assert.deepEqual(result, {
    customers: [{ id: 10, name: 'Cliente' }],
    leads: [{ id: 20, name: 'Lead' }],
  });
  assert.deepEqual(spy.calls, [{
    url: '/gf/logistics/api/employee/directory/search',
    data: { query: 'Cliente', limit: 20 },
    options: { timeoutMs: 7_777 },
  }]);
}

async function testDirectorySkipsEmptyQueryAndClampsLowerLimit(module: EmployeeDataLogicModule) {
  const spy = createPostSpy([{ data: { customers: [], leads: [] } }]);
  const client = module.createEmployeeDataClient({ postRest: spy.postRest, readTimeoutMs: 2_000 });

  assert.deepEqual(await client.searchEmployeeDirectory('   '), { customers: [], leads: [] });
  assert.equal(spy.calls.length, 0, 'query vacío no debe llamar red');

  await client.searchEmployeeDirectory('Ana', -3);
  assert.deepEqual(spy.calls[0], {
    url: '/gf/logistics/api/employee/directory/search',
    data: { query: 'Ana', limit: 1 },
    options: { timeoutMs: 2_000 },
  });
}

async function testPartnerFlowsExecuteScopedRequestsAndRejectInvalidIds(module: EmployeeDataLogicModule) {
  const spy = createPostSpy([
    { data: { customer: { id: 41, x_loyalty_level: 'oro' } } },
    { data: { customer: { id: 41, phone: '+527331112233' } } },
  ]);
  const client = module.createEmployeeDataClient({ postRest: spy.postRest, readTimeoutMs: 9_999 });

  assert.deepEqual(await client.getEmployeeScopedLoyalty(41), { id: 41, x_loyalty_level: 'oro' });
  assert.deepEqual(
    await client.updateEmployeeScopedContact(41, { name: 'Cliente', phone: '+527331112233', mobile: false, email: false }),
    { id: 41, phone: '+527331112233' },
  );
  assert.deepEqual(spy.calls, [
    {
      url: '/gf/logistics/api/employee/customer/loyalty',
      data: { partner_id: 41 },
      options: { timeoutMs: 9_999 },
    },
    {
      url: '/gf/logistics/api/employee/customer/contact/update',
      data: { partner_id: 41, values: { name: 'Cliente', phone: '+527331112233', mobile: false, email: false } },
      options: undefined,
    },
  ]);

  for (const partnerId of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(() => client.getEmployeeScopedLoyalty(partnerId));
  }
  assert.equal(spy.calls.length, 2, 'partner_id inválido no debe hacer red');
}

async function testUnwrapsValidEnvelopesAndDegradesInvalidResponses(module: EmployeeDataLogicModule) {
  assert.deepEqual(module.unwrapEmployeeEnvelope({ data: { customer: { id: 3 } } }), { customer: { id: 3 } });
  assert.equal(module.unwrapEmployeeEnvelope(null), null);
  assert.equal(module.unwrapEmployeeEnvelope([]), null);

  const spy = createPostSpy([null, { data: { customer: 'invalid' } }, { data: { customer: [] } }]);
  const client = module.createEmployeeDataClient({ postRest: spy.postRest, readTimeoutMs: 123 });
  assert.deepEqual(await client.searchEmployeeDirectory('Ana'), { customers: [], leads: [] });
  assert.equal(await client.getEmployeeScopedLoyalty(3), null);
  assert.equal(await client.updateEmployeeScopedContact(3, { name: 'Ana' }), null);
}

function testProductionClientUsesDefaultReadTimeout() {
  const source = readFileSync(resolve(REPO_ROOT, 'src/services/employeeData.ts'), 'utf8');
  assert.match(source, /readTimeoutMs:\s*DEFAULT_READ_TIMEOUT_MS/, 'las lecturas públicas deben usar DEFAULT_READ_TIMEOUT_MS');
}

async function main() {
  const module = await loadLogic();
  await testDirectoryExecutesScopedRequest(module);
  await testDirectorySkipsEmptyQueryAndClampsLowerLimit(module);
  await testPartnerFlowsExecuteScopedRequestsAndRejectInvalidIds(module);
  await testUnwrapsValidEnvelopesAndDegradesInvalidResponses(module);
  testProductionClientUsesDefaultReadTimeout();
  console.log('employee data tests: ok');
}

void main();
