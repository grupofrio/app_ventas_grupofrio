import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

const CONTRACT_ROOT = resolve('contracts/koldfield');
const EXPECTED_SCHEMA_SHA256 = 'ec160335cd9f3fe2a328d701b43ff130deb5d91dc95fbdb343606e554270e7b5';

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

test('day bundle rejects another employee and malformed expiry; soft-date keeps lease until expires_at', async () => {
  const logic = await loadLogic();
  const context = { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') };

  assert.throws(
    () => logic.evaluateStoredDayBundle(validRecord({ identity: { ...identity, employeeId: 43 } }), context),
    /identidad/i,
  );
  // Device calendar rollover before expires_at must not strand the seller.
  const afterLocalMidnight = logic.evaluateStoredDayBundle(
    validRecord(),
    { ...identity, operationalDate: '2026-08-15', nowMs: Date.parse('2026-08-15T01:00:00Z') },
  );
  assert.deepEqual(afterLocalMidnight, {
    mode: 'fresh', canRead: true, canStartRoute: true, canRunActions: true,
  });
  assert.throws(
    () => logic.evaluateStoredDayBundle(validRecord({ bundle: { ...validRecord().bundle as object, expires_at: 'not-a-date' } }), context),
    /expir/i,
  );
  assert.throws(
    () => logic.evaluateStoredDayBundle(validRecord({ bundle: { ...validRecord().bundle as object, plan: { id: 1, date: '2026-08-13', state: 'published', route_id: 1, vehicle_id: 1 } } }), context),
    /fecha operativa/i,
  );
  // New server bodies still require operational-date match.
  assert.throws(
    () => logic.replaceDayBundleAtomically(
      validRecord({ bundle: { ...validRecord().bundle as object, operational_date: '2026-08-13', plan: { id: 1, date: '2026-08-13', state: 'published', route_id: 1, vehicle_id: 1 } } }),
      context,
    ),
    /fecha operativa/i,
  );
});

test('crossing expires_at at company midnight blocks mutations but keeps read orientation', async () => {
  const logic = await loadLogic();
  // expires_at = 2026-08-15 05:59:59Z → stale at/after that instant
  const atExpiry = logic.evaluateStoredDayBundle(
    validRecord(),
    { ...identity, operationalDate: '2026-08-15', nowMs: Date.parse('2026-08-15T05:59:59Z') },
  );
  assert.deepEqual(atExpiry, {
    mode: 'stale', canRead: true, canStartRoute: false, canRunActions: false,
  });
  const justBefore = logic.evaluateStoredDayBundle(
    validRecord(),
    { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-15T05:59:58Z') },
  );
  assert.deepEqual(justBefore, {
    mode: 'fresh', canRead: true, canStartRoute: true, canRunActions: true,
  });
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

test('day bundle rejects malformed nested stop, catalog, directory, and reason records', async () => {
  const logic = await loadLogic();
  const context = { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') };
  const base = validRecord().bundle as Record<string, unknown>;

  for (const [field, value] of Object.entries({
    stops: [{}],
    catalog: [{}],
    directory: [{}],
    no_sale_reasons: [{}],
    gift_reasons: [{}],
    competitors: [{}],
  })) {
    assert.throws(
      () => logic.evaluateStoredDayBundle(validRecord({ bundle: { ...base, [field]: value } }), context),
      /inválido|debe|required|entero|campo/i,
      `${field} must reject an empty nested record`,
    );
  }

  assert.throws(
    () => logic.evaluateStoredDayBundle(validRecord({
      bundle: {
        ...base,
        catalog: [{ id: 1, name: 'Producto', default_code: null, uom_id: 1, stock_qty: 1, effective_prices: [{}] }],
      },
    }), context),
    /inválido|debe|required|entero|campo/i,
    'effective_prices must reject an empty nested record',
  );
  assert.throws(
    () => logic.evaluateStoredDayBundle(validRecord({
      bundle: {
        ...base,
        directory: [{ id: 1, name: 'Cliente', payment_term: null, latitude: '18.3', longitude: null }],
      },
    }), context),
    /latitude/i,
    'directory coordinates must keep the schema numeric type',
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
  const incoming = validRecord({
    etag: '"next"',
    bundle: {
      ...validRecord().bundle as object,
      catalog: [{ id: 7, name: 'Producto nuevo', default_code: null, uom_id: 1, stock_qty: 1, effective_prices: [] }],
    },
  });

  const replaced = logic.replaceDayBundleAtomically(incoming, context) as typeof incoming;
  assert.equal(replaced.etag, '"next"');
  assert.deepEqual(replaced.bundle.catalog, [{ id: 7, name: 'Producto nuevo', default_code: null, uom_id: 1, stock_qty: 1, effective_prices: [] }]);
  assert.deepEqual(replaced.bundle.directory, []);
  assert.notDeepEqual(replaced, prior);
});
