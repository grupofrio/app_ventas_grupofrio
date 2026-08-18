import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';

const CONTRACT_ROOT = resolve('contracts/koldfield');
const EXPECTED_SCHEMA_SHA256 = '394648af216001a44563add00d07417043001e8e10eca2f9bf03085304ba9df9';

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

test('day-bundle contract artifact pins the mobile schema and backend-compatible invoice DTO', () => {
  const schema = readFileSync(resolve(CONTRACT_ROOT, 'day_bundle.v1.schema.json'));
  const fixture = JSON.parse(readFileSync(resolve(CONTRACT_ROOT, 'day_bundle.v1.json'), 'utf8')) as Record<string, unknown>;
  const schemaDocument = JSON.parse(schema.toString('utf8')) as {
    required: string[];
    properties: Record<string, { maxItems?: number }>;
    $defs: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
  };

  assert.equal(createHash('sha256').update(schema).digest('hex'), EXPECTED_SCHEMA_SHA256);
  assert.equal(fixture.schema_version, 'day_bundle.v1');
  assert.equal(schemaDocument.required.includes('invoice_snapshots'), false);
  assert.equal(schemaDocument.properties.invoice_snapshots.maxItems, 1000);
  assert.deepEqual(schemaDocument.$defs.invoice_snapshot.required, ['stop_id', 'invoices', 'as_of']);
  assert.deepEqual(schemaDocument.$defs.open_invoice.required, [
    'invoice_id', 'name', 'invoice_date', 'due_date', 'currency', 'amount_residual',
  ]);
  assert.equal('commercial_partner_id' in (schemaDocument.$defs.open_invoice.properties ?? {}), false);
  assert.deepEqual((fixture.invoice_snapshots as Array<Record<string, unknown>>)[0], {
    stop_id: 1,
    as_of: '2026-08-14 12:00:00',
    invoices: [{
      invoice_id: 9,
      name: 'FAC/2026/0009',
      invoice_date: '2026-08-01',
      due_date: '2026-08-16',
      currency: 'MXN',
      amount_residual: 250,
    }],
  });
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

test('day bundle accepts the optional bounded invoice snapshots extension', async () => {
  const logic = await loadLogic();
  const context = { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') };
  const record = validRecord({
    bundle: {
      ...validRecord().bundle as object,
      invoice_snapshots: [{
        stop_id: 1,
        as_of: '2026-08-14 12:00:00',
        invoices: [{
          invoice_id: 9,
          name: 'FAC/2026/0009',
          invoice_date: '2026-08-01',
          due_date: '2026-08-16',
          currency: 'MXN',
          amount_residual: 250,
        }],
      }],
    },
  });

  const accepted = logic.replaceDayBundleAtomically(record, context) as { bundle: Record<string, unknown> };
  assert.deepEqual(accepted.bundle.invoice_snapshots, (record.bundle as Record<string, unknown>).invoice_snapshots);
});

test('day bundle accepts older v1 bodies that do not include invoice snapshots', async () => {
  const logic = await loadLogic();
  const context = { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') };

  const accepted = logic.replaceDayBundleAtomically(validRecord(), context) as { bundle: Record<string, unknown> };
  assert.equal('invoice_snapshots' in accepted.bundle, false);
});

test('day bundle rejects malformed, overlarge, or authority-bearing invoice snapshots', async () => {
  const logic = await loadLogic();
  const context = { ...identity, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') };
  const base = validRecord().bundle as Record<string, unknown>;
  const validSnapshot = {
    stop_id: 1,
    as_of: null,
    invoices: [{
      invoice_id: 9,
      name: 'FAC/2026/0009',
      invoice_date: null,
      due_date: null,
      currency: 'MXN',
      amount_residual: 1,
    }],
  };

  for (const snapshots of [
    Array.from({ length: 1001 }, () => validSnapshot),
    [{ ...validSnapshot, company_id: 34 }],
    [{ ...validSnapshot, invoices: [{ ...validSnapshot.invoices[0], journal_id: 10 }] }],
    [{ ...validSnapshot, invoices: [{ ...validSnapshot.invoices[0], amount_residual: 0 }] }],
    [{ ...validSnapshot, invoices: Array.from({ length: 101 }, () => validSnapshot.invoices[0]) }],
  ]) {
    assert.throws(
      () => logic.replaceDayBundleAtomically(validRecord({ bundle: { ...base, invoice_snapshots: snapshots } }), context),
      /invoice_snapshots|campo|positivo/i,
    );
  }
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
