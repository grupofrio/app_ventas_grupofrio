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

  console.log('route incident logic tests: ok');
}

void main();
