/**
 * Tests for routeIncidentLogic — Sprint B pure helpers.
 * Covers ES→backend mapping, label lookup, and payload validation.
 */

import assert from 'node:assert/strict';

interface IncidentLogicModule {
  INCIDENT_CATEGORIES: Array<{ key: string; label: string; backend: string }>;
  INCIDENT_SEVERITIES: Array<{ key: string; label: string; backend: string }>;
  toBackendIncidentType: (key: string | null | undefined) => string | null;
  toBackendSeverity: (key: string | null | undefined) => string | null;
  labelForIncidentType: (backend: string) => string;
  labelForSeverity: (backend: string) => string;
  buildIncidentPayload: (input: { typeKey: string | null; severityKey: string | null; description: string }) =>
    | { ok: true; payload: { incident_type: string; severity: string; name: string } }
    | { ok: false; reason: string };
  createIncidentSubmissionService: (input: {
    createEmployeeIncident: (payload: {
      operation_id: string;
      plan_id: number;
      incident_type: string;
      severity: string;
      note: string;
    }) => Promise<{ id: number; operation_id?: string } | null>;
    createOperationId: () => string;
  }) => {
    submit: (input: {
      planId: number;
      payload: { incident_type: string; severity: string; name: string };
    }) => Promise<{ id: number }>;
  };
}

function testCatalogMatchesBackendEnum(m: IncidentLogicModule) {
  const types = m.INCIDENT_CATEGORIES.map((c) => c.backend).sort();
  assert.deepEqual(types, ['collection', 'customer', 'operation', 'quality', 'vehicle']);
  const sevs = m.INCIDENT_SEVERITIES.map((s) => s.backend).sort();
  assert.deepEqual(sevs, ['high', 'low', 'medium']);
}

function testMapping(m: IncidentLogicModule) {
  assert.equal(m.toBackendIncidentType('operacion'), 'operation');
  assert.equal(m.toBackendIncidentType('vehiculo'), 'vehicle');
  assert.equal(m.toBackendIncidentType('cobranza'), 'collection');
  assert.equal(m.toBackendIncidentType('desconocido'), null);
  assert.equal(m.toBackendIncidentType(null), null);
  assert.equal(m.toBackendSeverity('alta'), 'high');
  assert.equal(m.toBackendSeverity('baja'), 'low');
  assert.equal(m.toBackendSeverity('x'), null);
}

function testLabels(m: IncidentLogicModule) {
  assert.equal(m.labelForIncidentType('vehicle'), 'Vehículo');
  assert.equal(m.labelForIncidentType('unknown_value'), 'unknown_value'); // graceful fallback
  assert.equal(m.labelForSeverity('high'), 'Alta');
  assert.equal(m.labelForSeverity('weird'), 'weird');
}

function testBuildPayloadValid(m: IncidentLogicModule) {
  const r = m.buildIncidentPayload({ typeKey: 'cliente', severityKey: 'media', description: '  No abrió la tienda  ' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.payload, { incident_type: 'customer', severity: 'medium', name: 'No abrió la tienda' });
    assert.equal('employee_id' in r.payload, false, 'la UI no decide la identidad del empleado');
    assert.equal('company_id' in r.payload, false, 'la UI no decide la compañía');
  }
}

function testBuildPayloadInvalid(m: IncidentLogicModule) {
  assert.equal(m.buildIncidentPayload({ typeKey: null, severityKey: 'alta', description: 'algo' }).ok, false);
  assert.equal(m.buildIncidentPayload({ typeKey: 'operacion', severityKey: null, description: 'algo' }).ok, false);
  assert.equal(m.buildIncidentPayload({ typeKey: 'operacion', severityKey: 'alta', description: '   ' }).ok, false);
  assert.equal(m.buildIncidentPayload({ typeKey: 'operacion', severityKey: 'alta', description: 'ab' }).ok, false);
  // invalid keys are rejected
  assert.equal(m.buildIncidentPayload({ typeKey: 'xx', severityKey: 'alta', description: 'valido aqui' }).ok, false);
}

async function testSubmissionRetainsOperationIdUntilConfirmed(m: IncidentLogicModule) {
  const requests: Array<Record<string, unknown>> = [];
  const ids = ['incident-op-1', 'incident-op-2', 'incident-op-3'];
  let attempt = 0;
  const service = m.createIncidentSubmissionService({
    createOperationId: () => ids.shift() ?? 'unexpected-operation-id',
    createEmployeeIncident: async (payload) => {
      requests.push(payload);
      attempt += 1;
      if (attempt === 1) {
        // El servidor pudo crear la incidencia, pero el cliente perdió la respuesta.
        throw new Error('respuesta perdida');
      }
      return { id: attempt, operation_id: payload.operation_id };
    },
  });
  const report = { incident_type: 'operation', severity: 'medium', name: 'Ruta bloqueada' };

  await assert.rejects(() => service.submit({ planId: 11, payload: report }), /respuesta perdida/);
  assert.deepEqual(await service.submit({ planId: 11, payload: report }), { id: 2 });
  // La confirmación válida retira el id: un nuevo envío del usuario obtiene otro.
  assert.deepEqual(await service.submit({ planId: 11, payload: report }), { id: 3 });

  assert.deepEqual(
    requests.map((request) => request.operation_id),
    ['incident-op-1', 'incident-op-1', 'incident-op-2'],
    'un retry debe conservar operation_id hasta recibir una respuesta válida',
  );
  for (const request of requests) {
    assert.equal('employee_id' in request, false);
    assert.equal('company_id' in request, false);
    assert.equal('token' in request, false);
  }
}

async function testSubmissionRequiresMatchingOperationId(m: IncidentLogicModule) {
  const requests: Array<Record<string, unknown>> = [];
  const service = m.createIncidentSubmissionService({
    createOperationId: () => 'incident-op-confirmed',
    createEmployeeIncident: async (payload) => {
      requests.push(payload);
      if (requests.length === 1) return { id: 71 };
      if (requests.length === 2) return { id: 71, operation_id: '' };
      return { id: 71, operation_id: payload.operation_id };
    },
  });
  const report = { incident_type: 'operation', severity: 'medium', name: 'Ruta bloqueada' };

  await assert.rejects(() => service.submit({ planId: 11, payload: report }), /operation_id/i);
  await assert.rejects(() => service.submit({ planId: 11, payload: report }), /operation_id/i);
  assert.deepEqual(await service.submit({ planId: 11, payload: report }), { id: 71 });
  assert.deepEqual(
    requests.map((request) => request.operation_id),
    ['incident-op-confirmed', 'incident-op-confirmed', 'incident-op-confirmed'],
    'una respuesta sin operation_id coincidente debe retener el borrador para retry',
  );
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/routeIncidentLogic.ts', import.meta.url).pathname
  ) as IncidentLogicModule;

  testCatalogMatchesBackendEnum(m);
  testMapping(m);
  testLabels(m);
  testBuildPayloadValid(m);
  testBuildPayloadInvalid(m);
  await testSubmissionRetainsOperationIdUntilConfirmed(m);
  await testSubmissionRequiresMatchingOperationId(m);

  console.log('route incident logic tests: ok');
}

void main();
