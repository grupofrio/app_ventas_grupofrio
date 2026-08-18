import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

interface Session {
  companyId: number;
  employeeId: number;
  sessionId: string;
}

interface DayBundleAccess {
  mode: 'fresh' | 'stale';
  canRead: true;
  canStartRoute: boolean;
  canRunActions: boolean;
}

interface StoredDayBundleLike {
  identity: { companyId: number; employeeId: number };
  etag: string;
  fetched_at_ms: number;
  bundle: { operational_date: string; expires_at: string | null };
}

interface DayBundleModule {
  applyEmployeeDayBundleReauthTransfer: (input: {
    previousSession: Session;
    nextSession: Session;
    nowMs: number;
    load: (session: Session, key: string) => Promise<unknown | null>;
    save: (session: Session, key: string, value: unknown) => Promise<void>;
  }) => Promise<{ transferred: boolean }>;
}

interface LogicModule {
  evaluateStoredDayBundle: (
    value: unknown,
    context: { companyId: number; employeeId: number; operationalDate: string; nowMs: number },
  ) => DayBundleAccess;
  replaceDayBundleAtomically: (
    value: unknown,
    context: { companyId: number; employeeId: number; operationalDate: string; nowMs: number },
    options?: { requireOperationalDateMatch?: boolean },
  ) => StoredDayBundleLike;
}

const DAY_BUNDLE_RECORD_KEY = 'day-bundle';
const oldSession: Session = { companyId: 7, employeeId: 19, sessionId: 'old-session' };
const newSession: Session = { companyId: 7, employeeId: 19, sessionId: 'new-session' };
const otherPrincipal: Session = { companyId: 7, employeeId: 20, sessionId: 'other-session' };

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'day_bundle.v1',
    operational_date: '2026-08-18',
    expires_at: '2026-08-19 05:59:59',
    plan: { id: 6922, date: '2026-08-18', state: 'in_progress', route_id: 4, vehicle_id: 2 },
    stops: [], catalog: [], directory: [], no_sale_reasons: [], gift_reasons: [], competitors: [],
    ...overrides,
  };
}

function record(overrides: Record<string, unknown> = {}, currentBundle = bundle()) {
  return {
    identity: { companyId: 7, employeeId: 19 },
    etag: '"original-etag"',
    fetched_at_ms: Date.parse('2026-08-18T09:00:00Z'),
    bundle: currentBundle,
    ...overrides,
  };
}

function sessionKey(session: Session): string {
  return `${session.companyId}:${session.employeeId}:${session.sessionId}`;
}

function createEncryptedHarness() {
  const envelopes = new Map<string, Map<string, unknown>>();
  const envelope = (session: Session) => {
    const key = sessionKey(session);
    const current = envelopes.get(key) ?? new Map<string, unknown>();
    envelopes.set(key, current);
    return current;
  };
  return {
    async load(session: Session, key: string) {
      return structuredClone(envelope(session).get(key) ?? null);
    },
    async save(session: Session, key: string, value: unknown) {
      envelope(session).set(key, structuredClone(value));
    },
  };
}

async function loadModules() {
  const dayBundle = (await import('../src/services/employeeDayBundle.ts')) as unknown as DayBundleModule;
  const logic = (await import('../src/services/employeeDayBundleLogic.ts')) as unknown as LogicModule;
  return { dayBundle, logic };
}

test('A) a day bundle stored under previousSession appears under nextSession after same-principal reauth', async () => {
  const { dayBundle } = await loadModules();
  const harness = createEncryptedHarness();
  await harness.save(oldSession, DAY_BUNDLE_RECORD_KEY, record());

  const result = await dayBundle.applyEmployeeDayBundleReauthTransfer({
    previousSession: oldSession, nextSession: newSession, nowMs: Date.parse('2026-08-18T12:00:00Z'),
    load: harness.load, save: harness.save,
  });

  assert.deepEqual(result, { transferred: true });
  const transferred = await harness.load(newSession, DAY_BUNDLE_RECORD_KEY);
  assert.ok(transferred, 'the record must exist under the new session after the handoff');
});

test('B) transfer preserves expires_at, operational_date, and etag unchanged (no renewal)', async () => {
  const { dayBundle } = await loadModules();
  const harness = createEncryptedHarness();
  const source = record({ etag: '"stable-etag-123"' }, bundle({
    operational_date: '2026-08-18',
    expires_at: '2026-08-19 05:59:59',
  }));
  await harness.save(oldSession, DAY_BUNDLE_RECORD_KEY, source);

  await dayBundle.applyEmployeeDayBundleReauthTransfer({
    previousSession: oldSession, nextSession: newSession, nowMs: Date.parse('2026-08-18T12:00:00Z'),
    load: harness.load, save: harness.save,
  });

  const transferred = (await harness.load(newSession, DAY_BUNDLE_RECORD_KEY)) as typeof source;
  assert.equal(transferred.etag, '"stable-etag-123"', 'ETag must pass through unchanged');
  assert.equal(transferred.bundle.operational_date, '2026-08-18');
  assert.equal(transferred.bundle.expires_at, '2026-08-19 05:59:59', 'expires_at must not be renewed by the transfer');
  assert.equal(transferred.fetched_at_ms, source.fetched_at_ms);
});

test('C) reauth handoff is a no-op (not an error) when there is no previous day bundle', async () => {
  const { dayBundle } = await loadModules();
  const harness = createEncryptedHarness();

  const result = await dayBundle.applyEmployeeDayBundleReauthTransfer({
    previousSession: oldSession, nextSession: newSession, nowMs: Date.parse('2026-08-18T12:00:00Z'),
    load: harness.load, save: harness.save,
  });

  assert.deepEqual(result, { transferred: false });
  assert.equal(await harness.load(newSession, DAY_BUNDLE_RECORD_KEY), null);
});

test('D) a bundle belonging to a different identity is never copied forward', async () => {
  const { dayBundle } = await loadModules();

  // A corrupted/foreign source record (identity does not match either session).
  const harnessForeignRecord = createEncryptedHarness();
  await harnessForeignRecord.save(
    oldSession,
    DAY_BUNDLE_RECORD_KEY,
    record({ identity: { companyId: 99, employeeId: 99 } }),
  );
  const foreignResult = await dayBundle.applyEmployeeDayBundleReauthTransfer({
    previousSession: oldSession, nextSession: newSession, nowMs: Date.parse('2026-08-18T12:00:00Z'),
    load: harnessForeignRecord.load, save: harnessForeignRecord.save,
  });
  assert.deepEqual(foreignResult, { transferred: false });
  assert.equal(await harnessForeignRecord.load(newSession, DAY_BUNDLE_RECORD_KEY), null);

  // A real account switch (different employeeId between sessions) must never
  // transfer, even when the source record itself is perfectly valid.
  const harnessAccountSwitch = createEncryptedHarness();
  await harnessAccountSwitch.save(oldSession, DAY_BUNDLE_RECORD_KEY, record());
  const crossPrincipalResult = await dayBundle.applyEmployeeDayBundleReauthTransfer({
    previousSession: oldSession, nextSession: otherPrincipal, nowMs: Date.parse('2026-08-18T12:00:00Z'),
    load: harnessAccountSwitch.load, save: harnessAccountSwitch.save,
  });
  assert.deepEqual(crossPrincipalResult, { transferred: false });
  assert.equal(await harnessAccountSwitch.load(otherPrincipal, DAY_BUNDLE_RECORD_KEY), null);
});

test('E) after handoff the record under the new session no longer reads as no_stored_record', async () => {
  const { dayBundle, logic } = await loadModules();
  const harness = createEncryptedHarness();
  await harness.save(oldSession, DAY_BUNDLE_RECORD_KEY, record());

  await dayBundle.applyEmployeeDayBundleReauthTransfer({
    previousSession: oldSession, nextSession: newSession, nowMs: Date.parse('2026-08-18T12:00:00Z'),
    load: harness.load, save: harness.save,
  });

  const transferred = await harness.load(newSession, DAY_BUNDLE_RECORD_KEY);
  assert.notEqual(transferred, null, 'loadCurrentEmployeeDayBundle would no longer see no_stored_record');

  // Mirrors what loadCurrentEmployeeDayBundle computes against the new
  // session's identity, without depending on the native encrypted store.
  const context = {
    companyId: newSession.companyId, employeeId: newSession.employeeId,
    operationalDate: '2026-08-18', nowMs: Date.parse('2026-08-18T12:00:00Z'),
  };
  const validated = logic.replaceDayBundleAtomically(transferred, context, { requireOperationalDateMatch: false });
  const access = logic.evaluateStoredDayBundle(transferred, context);
  assert.equal(validated.bundle.operational_date, '2026-08-18');
  assert.equal(access.mode, 'fresh');
  assert.equal(access.canRunActions, true);
});

test('a same-sessionId call (no actual rotation) never rewrites the destination', async () => {
  const { dayBundle } = await loadModules();
  const harness = createEncryptedHarness();
  await harness.save(oldSession, DAY_BUNDLE_RECORD_KEY, record());

  const result = await dayBundle.applyEmployeeDayBundleReauthTransfer({
    previousSession: oldSession, nextSession: oldSession, nowMs: Date.parse('2026-08-18T12:00:00Z'),
    load: harness.load, save: harness.save,
  });
  assert.deepEqual(result, { transferred: false });
});

test('auth wiring transfers the day bundle inside the same-principal handoff before the old envelope clears', () => {
  const source = readFileSync(resolve('src/stores/useAuthStore.ts'), 'utf8');
  const login = source.slice(source.indexOf('login: async'), source.indexOf('logout: async'));

  assert.match(login, /samePrincipalReauthentication/);
  assert.match(login, /transferEmployeeDayBundleForReauthentication/);
  assert(
    login.indexOf('const nextSession') < login.indexOf('transferEmployeeDayBundleForReauthentication'),
    'the transfer must use the freshly created nextSession identity',
  );
  assert(
    login.indexOf('await transferCurrentInvoiceCollectionsForReauthentication')
      < login.indexOf('transferEmployeeDayBundleForReauthentication'),
    'day-bundle transfer follows the same handoff step as the invoice-collection transfer',
  );
  assert(
    login.indexOf('transferEmployeeDayBundleForReauthentication') < login.indexOf('clearEncryptedSession'),
    'the day bundle must be copied before the old encrypted envelope is destroyed',
  );
});

console.log('employee day bundle reauthentication: ok');
