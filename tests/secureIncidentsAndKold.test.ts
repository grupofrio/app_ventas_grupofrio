import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const logicPath = resolve(REPO_ROOT, 'src/services/employeeDataLogic.ts');
const incidentsPath = resolve(REPO_ROOT, 'src/services/routeIncidents.ts');
const koldStorePath = resolve(REPO_ROOT, 'src/stores/useKoldStore.ts');
const gfLogisticsPath = resolve(REPO_ROOT, 'src/services/gfLogistics.ts');

type RestPost = (
  url: string,
  data: Record<string, unknown>,
  options?: { timeoutMs?: number },
) => Promise<unknown>;

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

interface EmployeeDataLogicModule {
  createEmployeeDataClient: (input: {
    postRest: RestPost;
    readTimeoutMs: number;
  }) => {
    createEmployeeIncident: (payload: {
      operation_id: string;
      plan_id: number;
      stop_id?: number;
      incident_type: string;
      severity: string;
      note?: string;
    }) => Promise<Record<string, unknown> | null>;
    listEmployeeIncidents: (options?: {
      plan_id?: number;
      limit?: number;
      offset?: number;
    }) => Promise<Array<Record<string, unknown>>>;
    getKoldInsights: (partnerIds: number[]) => Promise<{
      scores_available: boolean;
      forecasts_available: boolean;
      scores: Array<Record<string, unknown>>;
      forecasts: Array<Record<string, unknown>>;
    }>;
  };
}

async function loadLogic(): Promise<EmployeeDataLogicModule> {
  assert.equal(existsSync(logicPath), true, 'el cliente REST de empleado debe existir');
  return await import(logicPath) as EmployeeDataLogicModule;
}

async function testIncidentAdaptersUseOnlyScopedEmployeeRoutes(module: EmployeeDataLogicModule) {
  const spy = createPostSpy([
    { data: { incident: { id: 71, operation_id: 'incident-71' } } },
    { data: { incidents: [{ id: 71, note: 'Ruta bloqueada' }] } },
  ]);
  const client = module.createEmployeeDataClient({ postRest: spy.postRest, readTimeoutMs: 8_000 });

  assert.deepEqual(
    await client.createEmployeeIncident({
      operation_id: 'incident-71',
      plan_id: 11,
      stop_id: 12,
      incident_type: 'operation',
      severity: 'medium',
      note: 'Ruta bloqueada',
    }),
    {
      id: 71,
      operation_id: 'incident-71',
      plan_id: null,
      stop_id: null,
      incident_type: '',
      severity: '',
      note: '',
    },
  );
  assert.deepEqual(
    await client.listEmployeeIncidents({ plan_id: 11, limit: 500, offset: 20_000 }),
    [{
      id: 71,
      operation_id: '',
      plan_id: null,
      stop_id: null,
      incident_type: '',
      severity: '',
      note: 'Ruta bloqueada',
    }],
  );

  assert.deepEqual(spy.calls, [
    {
      url: '/gf/logistics/api/employee/incidents/create',
      data: {
        operation_id: 'incident-71',
        plan_id: 11,
        stop_id: 12,
        incident_type: 'operation',
        severity: 'medium',
        note: 'Ruta bloqueada',
      },
      options: undefined,
    },
    {
      url: '/gf/logistics/api/employee/incidents/list',
      data: { plan_id: 11, limit: 100, offset: 10_000 },
      options: { timeoutMs: 8_000 },
    },
  ]);

  for (const body of spy.calls.map((call) => call.data)) {
    for (const forbidden of ['employee_id', 'employeeId', 'company_id', 'companyId', 'plaza_id', 'token', 'gf_employee_token']) {
      assert.equal(forbidden in body, false, `${forbidden} nunca debe viajar desde el cliente`);
    }
  }
}

async function testIncidentAdaptersRejectInvalidContextWithoutNetwork(module: EmployeeDataLogicModule) {
  const spy = createPostSpy([]);
  const client = module.createEmployeeDataClient({ postRest: spy.postRest, readTimeoutMs: 8_000 });

  await assert.rejects(() => client.createEmployeeIncident({
    operation_id: '',
    plan_id: 11,
    incident_type: 'operation',
    severity: 'medium',
  }));
  await assert.rejects(() => client.createEmployeeIncident({
    operation_id: 'incident-invalid',
    plan_id: 0,
    incident_type: 'operation',
    severity: 'medium',
  }));
  await assert.rejects(() => client.createEmployeeIncident({
    operation_id: 'incident-invalid',
    plan_id: 11,
    stop_id: -1,
    incident_type: 'operation',
    severity: 'medium',
  }));
  await assert.rejects(() => client.listEmployeeIncidents({ plan_id: -1 }));
  await assert.rejects(() => client.listEmployeeIncidents({ limit: -1 }));
  await assert.rejects(() => client.listEmployeeIncidents({ offset: -1 }));
  assert.equal(spy.calls.length, 0, 'validaciones locales no deben tocar la red');
}

async function testIncidentCreateRejectsUnconfirmedServerResponses(module: EmployeeDataLogicModule) {
  const spy = createPostSpy([
    { data: {} },
    { data: { incident: { id: 0 } } },
    { data: { incident: { id: '71' } } },
    { data: { incident: { id: 71 } } },
    { data: { incident: { id: 71, operation_id: '' } } },
    { data: { incident: { id: 71, operation_id: 'other-operation' } } },
    { data: { incident: { id: 72, operation_id: 'expected-operation' } } },
  ]);
  const client = module.createEmployeeDataClient({ postRest: spy.postRest, readTimeoutMs: 8_000 });
  const payload = {
    operation_id: 'expected-operation',
    plan_id: 11,
    incident_type: 'operation',
    severity: 'medium',
    note: 'Respuesta válida',
  };

  await assert.rejects(() => client.createEmployeeIncident(payload), /confirmó/i);
  await assert.rejects(() => client.createEmployeeIncident(payload), /confirmó/i);
  await assert.rejects(() => client.createEmployeeIncident(payload), /confirmó/i);
  await assert.rejects(() => client.createEmployeeIncident(payload), /operation_id/i);
  await assert.rejects(() => client.createEmployeeIncident(payload), /operation_id/i);
  await assert.rejects(() => client.createEmployeeIncident(payload), /operation_id/i);
  assert.deepEqual(await client.createEmployeeIncident(payload), {
    id: 72,
    operation_id: 'expected-operation',
    plan_id: null,
    stop_id: null,
    incident_type: '',
    severity: '',
    note: '',
  });
}

async function testKoldInsightsUsesOneAllowlistedBatchRequest(module: EmployeeDataLogicModule) {
  const spy = createPostSpy([{
    data: {
      scores_available: true,
      forecasts_available: false,
      scores: [{
        id: 1,
        partner_id: 7,
        score_master: 88,
        strategic_category: 'joya',
        priority_level: 'alta',
        suggested_action: 'Visitar',
        recommendation_summary: 'Cliente prioritario',
        last_scored_at: '2026-07-16T10:00:00',
        forbidden_field: 'must-not-reach-the-store',
      }],
      forecasts: [{
        id: 2,
        partner_id: 7,
        forecast_date: '2026-07-16',
        predicted_kg: 12.5,
        probability_of_purchase: 0.8,
        confidence_level: 'high',
        confidence_score: 91,
        forbidden_field: 'must-not-reach-the-store',
      }],
    },
  }]);
  const client = module.createEmployeeDataClient({ postRest: spy.postRest, readTimeoutMs: 9_000 });

  const result = await client.getKoldInsights([7, 8, 7]);

  assert.deepEqual(spy.calls, [{
    url: '/gf/logistics/api/employee/kold/insights',
    data: { partner_ids: [7, 8] },
    options: { timeoutMs: 9_000 },
  }]);
  assert.deepEqual(result, {
    scores_available: true,
    forecasts_available: false,
    scores: [{
      id: 1,
      partner_id: 7,
      score_master: 88,
      strategic_category: 'joya',
      priority_level: 'alta',
      suggested_action: 'Visitar',
      recommendation_summary: 'Cliente prioritario',
      last_scored_at: '2026-07-16T10:00:00',
    }],
    forecasts: [{
      id: 2,
      partner_id: 7,
      forecast_date: '2026-07-16',
      predicted_kg: 12.5,
      probability_of_purchase: 0.8,
      confidence_level: 'high',
      confidence_score: 91,
    }],
  });
}

async function testKoldInsightsRejectsInvalidOrOversizedBatches(module: EmployeeDataLogicModule) {
  const spy = createPostSpy([]);
  const client = module.createEmployeeDataClient({ postRest: spy.postRest, readTimeoutMs: 9_000 });

  await assert.rejects(() => client.getKoldInsights([0]));
  await assert.rejects(() => client.getKoldInsights([1.2]));
  await assert.rejects(() => client.getKoldInsights(Array.from({ length: 501 }, (_, index) => index + 1)));
  assert.equal(spy.calls.length, 0, 'un lote inválido no debe tocar la red');
}

function testMobileFlowsHaveNoGenericRpcFallbacks() {
  const incidents = readFileSync(incidentsPath, 'utf8');
  const koldStore = readFileSync(koldStorePath, 'utf8');
  const gfLogistics = readFileSync(gfLogisticsPath, 'utf8');

  assert.doesNotMatch(incidents, /from\s+['"][^'"]*odooRpc['"]/, 'incidencias no debe importar odooRpc');
  assert.doesNotMatch(incidents, /\b(?:odooRead|odooWrite|postRpc)\b/, 'incidencias no debe exponer fallback RPC');
  assert.match(incidents, /createEmployeeIncident/, 'incidencias debe usar el adaptador REST de empleado');
  assert.match(incidents, /listEmployeeIncidents/, 'la lista debe usar el adaptador REST de empleado');
  assert.doesNotMatch(koldStore, /\bkoldRead\b/, 'KOLD no debe consultar modelos desde el teléfono');
  assert.doesNotMatch(koldStore, /from\s+['"][^'"]*odooRpc['"]/, 'KOLD no debe importar odooRpc');
  assert.match(koldStore, /getKoldInsights/, 'KOLD debe usar el endpoint agregado de insights');
  assert.match(koldStore, /scores_available/, 'KOLD debe conservar la disponibilidad explícita de scores');
  assert.match(koldStore, /forecasts_available/, 'KOLD debe conservar la disponibilidad explícita de forecasts');
  assert.doesNotMatch(gfLogistics, /\bodooRead\b/, 'inventario REST no debe documentar ni ofrecer un fallback RPC');
  assert.match(gfLogistics, /Promise<TruckStockResponse \| null>/, 'inventario REST debe degradar explícitamente a no disponible');
}

async function main() {
  const module = await loadLogic();
  await testIncidentAdaptersUseOnlyScopedEmployeeRoutes(module);
  await testIncidentAdaptersRejectInvalidContextWithoutNetwork(module);
  await testIncidentCreateRejectsUnconfirmedServerResponses(module);
  await testKoldInsightsUsesOneAllowlistedBatchRequest(module);
  await testKoldInsightsRejectsInvalidOrOversizedBatches(module);
  testMobileFlowsHaveNoGenericRpcFallbacks();
  console.log('secure incidents and KOLD tests: ok');
}

void main();
