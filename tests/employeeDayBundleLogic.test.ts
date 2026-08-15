import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

const CONTRACT_ROOT = resolve('contracts/koldfield');
const EXPECTED_SCHEMA_SHA256 = 'ee610e0fbe3ddfc94b655217b277821f3be79d11c56d9d54db3fcff6271774fa';

interface DayBundleLogic {
  evaluateStoredDayBundle: (record: unknown, context: {
    companyId: number;
    employeeId: number;
    operationalDate: string;
    nowMs: number;
  }) => { mode: 'fresh' | 'stale'; canRead: true; canStartRoute: boolean; canRunActions: boolean };
  replaceDayBundleAtomically: (incoming: unknown, context: {
    companyId: number;
    employeeId: number;
    operationalDate: string;
    nowMs: number;
  }) => unknown;
}

const identity = { companyId: 34, employeeId: 42 };

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    identity,
    etag: '"bundle-v1"',
    fetched_at_ms: Date.parse('2026-08-14T10:00:00Z'),
    bundle: {
      schema_version: 'day_bundle.v1',
      operational_date: '2026-08-14',
      expires_at: '2026-08-15 05:59:59',
      plan: { id: 1, date: '2026-08-14', state: 'published', route_id: 1, vehicle_id: 1 },
      stops: [], catalog: [], directory: [], no_sale_reasons: [], gift_reasons: [], competitors: [],
    },
    ...overrides,
  };
}

async function loadLogic(): Promise<DayBundleLogic> {
  return await import('../src/services/employeeDayBundleLogic.ts') as DayBundleLogic;
}

test('day-bundle contract artifact matches the pinned backend schema hash', () => {
  const schema = readFileSync(resolve(CONTRACT_ROOT, 'day_bundle.v1.schema.json'));
  const fixture = JSON.parse(readFileSync(resolve(CONTRACT_ROOT, 'day_bundle.v1.json'), 'utf8')) as {
    schema_version?: string;
  };

  assert.equal(createHash('sha256').update(schema).digest('hex'), EXPECTED_SCHEMA_SHA256);
  assert.equal(fixture.schema_version, 'day_bundle.v1');
});

test('day bundle rejects another employee, another operational date, and malformed expiry', async () => {
  const logic = await loadLogic();
  const context = { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') };

  assert.throws(
    () => logic.evaluateStoredDayBundle(validRecord({ identity: { ...identity, employeeId: 43 } }), context),
    /identidad/i,
  );
  assert.throws(
    () => logic.evaluateStoredDayBundle(validRecord({ bundle: { ...validRecord().bundle as object, operational_date: '2026-08-13' } }), context),
    /fecha operativa/i,
  );
  assert.throws(
    () => logic.evaluateStoredDayBundle(validRecord({ bundle: { ...validRecord().bundle as object, expires_at: 'not-a-date' } }), context),
    /expir/i,
  );
  assert.throws(
    () => logic.evaluateStoredDayBundle(validRecord({ bundle: { ...validRecord().bundle as object, plan: { id: 1, date: '2026-08-13', state: 'published', route_id: 1, vehicle_id: 1 } } }), context),
    /fecha operativa/i,
  );
});

test('day bundle rejects schema-drift fields and capped arrays before persistence', async () => {
  const logic = await loadLogic();
  const context = { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') };

  assert.throws(
    () => logic.replaceDayBundleAtomically(validRecord({ bundle: { ...validRecord().bundle as object, injected: true } }), context),
    /campo .*permitido/i,
  );
  assert.throws(
    () => logic.replaceDayBundleAtomically(validRecord({ bundle: { ...validRecord().bundle as object, stops: Array.from({ length: 1001 }, () => ({})) } }), context),
    /stops.*1000/i,
  );
});

test('expired bundle remains read-only and blocks route start and operational actions', async () => {
  const logic = await loadLogic();
  const access = logic.evaluateStoredDayBundle(
    validRecord({ bundle: { ...validRecord().bundle as object, expires_at: '2026-08-14 05:59:59' } }),
    { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') },
  );

  assert.deepEqual(access, {
    mode: 'stale', canRead: true, canStartRoute: false, canRunActions: false,
  });
});

test('fresh bundle permits route start and operational actions', async () => {
  const logic = await loadLogic();
  const access = logic.evaluateStoredDayBundle(
    validRecord(),
    { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') },
  );

  assert.deepEqual(access, {
    mode: 'fresh', canRead: true, canStartRoute: true, canRunActions: true,
  });
});

test('day-bundle replacement accepts one complete validated version without mixing old sections', async () => {
  const logic = await loadLogic();
  const context = { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') };
  const prior = validRecord({ etag: '"prior"', bundle: { ...validRecord().bundle as object, directory: [{ id: 99 }] } });
  const incoming = validRecord({ etag: '"next"', bundle: { ...validRecord().bundle as object, catalog: [{ id: 7 }] } });

  const replaced = logic.replaceDayBundleAtomically(incoming, context) as typeof incoming;
  assert.equal(replaced.etag, '"next"');
  assert.deepEqual(replaced.bundle.catalog, [{ id: 7 }]);
  assert.deepEqual(replaced.bundle.directory, []);
  assert.notDeepEqual(replaced, prior);
});
