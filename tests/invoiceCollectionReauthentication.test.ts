import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

interface Session {
  companyId: number;
  employeeId: number;
  sessionId: string;
}

interface EncryptedApi {
  getRecord<T>(key: string): T | null;
  setRecord<T>(key: string, value: T): void;
}

interface PersistenceModule {
  createInvoiceCollectionPersistence(deps: {
    load: (session: Session, key: string) => Promise<unknown | null>;
    update: (session: Session, mutator: (api: EncryptedApi) => void | Promise<void>) => Promise<void>;
    remove: (session: Session, key: string) => Promise<void>;
  }): {
    list(session: Session): Promise<Array<Record<string, unknown>>>;
    insert(session: Session, intent: Record<string, unknown>): Promise<void>;
    findOrInsert(session: Session, intent: Record<string, unknown>): Promise<Record<string, unknown>>;
    transition(session: Session, operationId: string, status: 'pending' | 'applied' | 'review_required' | 'reauth_required', nowMs: number): Promise<void>;
    transferForSamePrincipal(
      oldSession: Session,
      newSession: Session,
      activateDestination: () => Promise<void>,
    ): Promise<{
      transferred: boolean;
      count: number;
    }>;
  };
  createInvoiceCollectionReauthAwarePersistence(
    persistence: {
      list(): Promise<Array<Record<string, unknown>>>;
      insert(intent: Record<string, unknown>): Promise<void>;
      findOrInsert(intent: Record<string, unknown>): Promise<Record<string, unknown>>;
      transition(operationId: string, status: 'pending' | 'applied' | 'review_required' | 'reauth_required', nowMs: number): Promise<void>;
    },
    latch: {
      isRequired(): Promise<boolean>;
      markRequired(): Promise<void>;
    },
  ): {
    list(): Promise<Array<Record<string, unknown>>>;
    insert(intent: Record<string, unknown>): Promise<void>;
    findOrInsert(intent: Record<string, unknown>): Promise<Record<string, unknown>>;
    transition(operationId: string, status: 'pending' | 'applied' | 'review_required' | 'reauth_required', nowMs: number): Promise<void>;
    markReauthenticationRequired(): Promise<void>;
  };
}

interface LatchModule {
  createInvoiceCollectionReauthLatch(driver: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  }): {
    isRequired(session: Session): Promise<boolean>;
    markRequired(session: Session): Promise<void>;
    clear(session: Session): Promise<void>;
  };
}

interface SyncModule {
  createInvoiceCollectionSyncProcessor(deps: unknown): {
    capture(intent: Record<string, unknown>): Promise<{ status: string; operationId: string }>;
    reconcile(): Promise<void>;
  };
}

interface VisitModule {
  buildVisitCollectionState(bundle: unknown, stopId: number, intents: unknown[]): {
    invoices: Array<{
      collection_state: string;
      intent: { operation_id: string; status: string } | null;
    }>;
  };
}

const oldSession = { companyId: 7, employeeId: 19, sessionId: 'old-session' };
const newSession = { companyId: 7, employeeId: 19, sessionId: 'new-session' };
const intent = {
  operation_id: '11111111-2222-4aaa-8bbb-333333333333', stop_id: 5, invoice_id: 8,
  amount: 25, payment_method: 'cash', snapshot_residual: 30, snapshot_as_of: null,
  status: 'pending', created_at_ms: 1, updated_at_ms: 2,
};
const bundle = {
  schema_version: 'day_bundle.v1', operational_date: '2026-08-18', expires_at: null,
  plan: { id: 1, date: '2026-08-18', state: 'in_progress', route_id: 2, vehicle_id: 3 },
  stops: [{ id: 5, sequence: 1, state: 'in_progress', kind: 'customer', customer: { id: 4, name: 'Cliente' }, payment_term: null }],
  catalog: [], directory: [], no_sale_reasons: [], gift_reasons: [], competitors: [],
  invoice_snapshots: [{
    stop_id: 5,
    as_of: null,
    invoices: [{ invoice_id: 8, name: 'FAC/8', invoice_date: null, due_date: null, currency: 'MXN', amount_residual: 30 }],
  }],
};

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
    async update(session: Session, mutator: (api: EncryptedApi) => void | Promise<void>) {
      const staged = new Map(envelope(session));
      await mutator({
        getRecord: <T>(key: string) => structuredClone(staged.get(key) ?? null) as T | null,
        setRecord: <T>(key: string, value: T) => { staged.set(key, structuredClone(value)); },
      });
      envelopes.set(sessionKey(session), staged);
    },
    async remove(session: Session, key: string) {
      envelope(session).delete(key);
    },
    clear(session: Session) {
      envelopes.delete(sessionKey(session));
    },
  };
}

test('a failed reauth latch read happens before findOrInsert can commit an intent', async () => {
  const persistenceModule = await import('../src/services/invoiceCollectionPersistence.ts') as unknown as PersistenceModule;
  let commits = 0;
  const persistence = persistenceModule.createInvoiceCollectionReauthAwarePersistence({
    async list() { return []; },
    async insert() {},
    async findOrInsert(candidate) {
      commits += 1;
      return candidate;
    },
    async transition() {},
  }, {
    async isRequired() { throw new Error('SecureStore read failed'); },
    async markRequired() {},
  });

  await assert.rejects(() => persistence.findOrInsert(intent), /SecureStore read failed/);
  assert.equal(commits, 0, 'a latch read failure must remain before the encrypted intent commit point');
});

test('background 401 reenters with reauth action and same-principal handoff replays the original UUID', async () => {
  const persistenceModule = await import('../src/services/invoiceCollectionPersistence.ts') as unknown as PersistenceModule;
  const syncModule = await import('../src/services/invoiceCollectionSync.ts') as unknown as SyncModule;
  const visitModule = await import('../src/services/invoiceCollectionVisit.ts') as unknown as VisitModule;
  const harness = createEncryptedHarness();
  const persistence = persistenceModule.createInvoiceCollectionPersistence(harness);
  let revokedAttempts = 0;

  await persistence.insert(oldSession, intent);

  const beforeReauthentication = syncModule.createInvoiceCollectionSyncProcessor({
    persistence: {
      list: () => persistence.list(oldSession),
      insert: (candidate: Record<string, unknown>) => persistence.insert(oldSession, candidate),
      findOrInsert: (candidate: Record<string, unknown>) => persistence.findOrInsert(oldSession, candidate),
      transition: (operationId: string, status: 'pending' | 'applied' | 'review_required' | 'reauth_required', nowMs: number) =>
        persistence.transition(oldSession, operationId, status, nowMs),
    },
    isOnline: () => true,
    now: () => 3,
    transport: {
      collect: async () => {
        revokedAttempts += 1;
        throw Object.assign(new Error('token revoked'), {
          httpStatus: 401,
          code: 'token_revoked',
          responseReceived: true,
        });
      },
    },
  });
  await beforeReauthentication.reconcile();
  assert.equal(revokedAttempts, 1, 'a reconnect before successful login must not POST with revoked credentials');
  const after401 = await persistence.list(oldSession);
  assert.deepEqual(after401, [{ ...intent, status: 'reauth_required', updated_at_ms: 3 }]);
  assert.deepEqual({
    operation_id: after401[0].operation_id,
    stop_id: after401[0].stop_id,
    invoice_id: after401[0].invoice_id,
    amount: after401[0].amount,
    payment_method: after401[0].payment_method,
    snapshot_residual: after401[0].snapshot_residual,
    snapshot_as_of: after401[0].snapshot_as_of,
  }, {
    operation_id: intent.operation_id,
    stop_id: intent.stop_id,
    invoice_id: intent.invoice_id,
    amount: intent.amount,
    payment_method: intent.payment_method,
    snapshot_residual: intent.snapshot_residual,
    snapshot_as_of: intent.snapshot_as_of,
  }, 'durable reauth must preserve the UUID and immutable collection binding');

  const reentered = visitModule.buildVisitCollectionState(bundle, intent.stop_id, after401);
  assert.equal(reentered.invoices[0].collection_state, 'reauth_required');
  assert.equal(reentered.invoices[0].intent?.operation_id, intent.operation_id);

  const restartedBeforeLogin = syncModule.createInvoiceCollectionSyncProcessor({
    persistence: {
      list: () => persistence.list(oldSession),
      insert: (candidate: Record<string, unknown>) => persistence.insert(oldSession, candidate),
      findOrInsert: (candidate: Record<string, unknown>) => persistence.findOrInsert(oldSession, candidate),
      transition: (operationId: string, status: 'pending' | 'applied' | 'review_required' | 'reauth_required', nowMs: number) =>
        persistence.transition(oldSession, operationId, status, nowMs),
    },
    isOnline: () => true,
    now: () => 3,
    transport: {
      collect: async () => {
        revokedAttempts += 1;
        return { status: 'applied', operation_id: intent.operation_id };
      },
    },
  });
  await restartedBeforeLogin.reconcile();
  assert.equal(revokedAttempts, 1, 'durable reauth must pause a fresh processor before login');

  let activated = false;
  assert.deepEqual(await persistence.transferForSamePrincipal(oldSession, newSession, async () => {
    activated = true;
  }), {
    transferred: true,
    count: 1,
  });
  assert.equal(activated, true);
  assert.deepEqual(await persistence.list(oldSession), [], 'old copy is deleted only after the new copy commits');
  assert.deepEqual(await persistence.list(newSession), [{ ...intent, status: 'pending', updated_at_ms: 3 }]);

  const sent: string[] = [];
  const restarted = syncModule.createInvoiceCollectionSyncProcessor({
    persistence: {
      list: () => persistence.list(newSession),
      insert: (candidate: Record<string, unknown>) => persistence.insert(newSession, candidate),
      findOrInsert: async (candidate: Record<string, unknown>) => candidate,
      transition: (operationId: string, status: 'pending' | 'applied' | 'review_required' | 'reauth_required', nowMs: number) =>
        persistence.transition(newSession, operationId, status, nowMs),
    },
    isOnline: () => true,
    now: () => 3,
    transport: {
      collect: async (request: { operation_id: string }) => {
        sent.push(request.operation_id);
        return { status: 'applied', operation_id: request.operation_id };
      },
    },
  });
  await restarted.reconcile();

  assert.deepEqual(sent, [intent.operation_id]);
  assert.equal((await persistence.list(newSession))[0].operation_id, intent.operation_id);
  assert.equal((await persistence.list(newSession))[0].status, 'applied');
});

test('a separate session latch survives processor restart when the 401 intent marker cannot commit', async () => {
  const persistenceModule = await import('../src/services/invoiceCollectionPersistence.ts') as unknown as PersistenceModule;
  const latchModule = await import('../src/services/invoiceCollectionReauthLatchLogic.ts') as unknown as LatchModule;
  const syncModule = await import('../src/services/invoiceCollectionSync.ts') as unknown as SyncModule;
  const visitModule = await import('../src/services/invoiceCollectionVisit.ts') as unknown as VisitModule;
  const harness = createEncryptedHarness();
  const persistence = persistenceModule.createInvoiceCollectionPersistence(harness);
  const latchRecords = new Map<string, string>();
  const latch = latchModule.createInvoiceCollectionReauthLatch({
    async get(key) { return latchRecords.get(key) ?? null; },
    async set(key, value) { latchRecords.set(key, value); },
    async remove(key) { latchRecords.delete(key); },
  });
  const secondIntent = {
    ...intent,
    operation_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    stop_id: 6,
    invoice_id: 9,
  };
  await persistence.insert(oldSession, intent);
  await persistence.insert(oldSession, secondIntent);

  function bound(session: Session, failReauthMarker = false) {
    return persistenceModule.createInvoiceCollectionReauthAwarePersistence({
      list: () => persistence.list(session),
      insert: (candidate) => persistence.insert(session, candidate),
      findOrInsert: (candidate) => persistence.findOrInsert(session, candidate),
      transition: (operationId, status, nowMs) => {
        if (failReauthMarker && status === 'reauth_required') {
          return Promise.reject(new Error('invoice envelope write failed'));
        }
        return persistence.transition(session, operationId, status, nowMs);
      },
    }, {
      isRequired: () => latch.isRequired(session),
      markRequired: () => latch.markRequired(session),
    });
  }

  const sentWithRevokedToken: string[] = [];
  const beforeRestart = syncModule.createInvoiceCollectionSyncProcessor({
    persistence: bound(oldSession, true),
    isOnline: () => true,
    now: () => 3,
    transport: {
      collect: async (request: { operation_id: string }) => {
        sentWithRevokedToken.push(request.operation_id);
        throw Object.assign(new Error('token revoked'), {
          httpStatus: 401,
          code: 'token_revoked',
          responseReceived: true,
        });
      },
    },
  });
  await beforeRestart.reconcile();
  assert.deepEqual(sentWithRevokedToken, [intent.operation_id]);
  assert.equal(await latch.isRequired(oldSession), true);
  assert.equal((await persistence.list(oldSession))[0].status, 'pending', 'the invoice marker write really failed');

  const projected = await bound(oldSession).list();
  assert.equal(projected[0].status, 'reauth_required');
  assert.equal(
    visitModule.buildVisitCollectionState(bundle, intent.stop_id, projected).invoices[0].collection_state,
    'reauth_required',
  );

  const afterRestart = syncModule.createInvoiceCollectionSyncProcessor({
    persistence: bound(oldSession),
    isOnline: () => true,
    now: () => 4,
    transport: {
      collect: async (request: { operation_id: string }) => {
        sentWithRevokedToken.push(request.operation_id);
        return { status: 'applied', operation_id: request.operation_id };
      },
    },
  });
  await afterRestart.reconcile();
  assert.deepEqual(sentWithRevokedToken, [intent.operation_id], 'restart must observe the latch before any POST');

  await persistence.transferForSamePrincipal(oldSession, newSession, async () => {});
  await latch.clear(oldSession);
  assert.equal(await latch.isRequired(oldSession), false);
  assert.deepEqual(
    (await persistence.list(newSession)).map((candidate) => candidate.status),
    ['pending', 'pending'],
    'the destination is durable and replayable before the old latch is cleared',
  );

  const replayed: string[] = [];
  const afterReauthentication = syncModule.createInvoiceCollectionSyncProcessor({
    persistence: bound(newSession),
    isOnline: () => true,
    now: () => 5,
    transport: {
      collect: async (request: { operation_id: string }) => {
        replayed.push(request.operation_id);
        return { status: 'applied', operation_id: request.operation_id };
      },
    },
  });
  await afterReauthentication.reconcile();
  assert.deepEqual(replayed, [intent.operation_id, secondIntent.operation_id]);
  assert.equal((await persistence.list(newSession))[0].operation_id, intent.operation_id);
});

test('account switch never transfers invoice collection data and destructive cleanup removes the old record', async () => {
  const persistenceModule = await import('../src/services/invoiceCollectionPersistence.ts') as unknown as PersistenceModule;
  const harness = createEncryptedHarness();
  const persistence = persistenceModule.createInvoiceCollectionPersistence(harness);
  const otherPrincipal = { companyId: 7, employeeId: 20, sessionId: 'other-session' };

  const reauthIntent = { ...intent, status: 'reauth_required', updated_at_ms: 3 };
  await persistence.insert(oldSession, reauthIntent);
  assert.deepEqual(await persistence.transferForSamePrincipal(oldSession, otherPrincipal, async () => {
    assert.fail('cross-principal handoff must not activate the destination session');
  }), {
    transferred: false,
    count: 0,
  });
  assert.deepEqual(await persistence.list(otherPrincipal), []);
  assert.deepEqual(await persistence.list(oldSession), [reauthIntent], 'a rejected handoff must not delete evidence itself');

  harness.clear(oldSession);
  assert.deepEqual(await persistence.list(oldSession), [], 'the existing account-switch cleanup remains destructive');
});

test('failed destination-session activation keeps the old encrypted copy recoverable', async () => {
  const persistenceModule = await import('../src/services/invoiceCollectionPersistence.ts') as unknown as PersistenceModule;
  const harness = createEncryptedHarness();
  const persistence = persistenceModule.createInvoiceCollectionPersistence(harness);

  const reauthIntent = { ...intent, status: 'reauth_required', updated_at_ms: 3 };
  await persistence.insert(oldSession, reauthIntent);
  await assert.rejects(
    () => persistence.transferForSamePrincipal(oldSession, newSession, async () => {
      throw new Error('SecureStore rotation failed');
    }),
    /SecureStore rotation failed/,
  );

  assert.deepEqual(await persistence.list(oldSession), [reauthIntent]);
  assert.deepEqual(
    await persistence.list(newSession),
    [{ ...intent, status: 'pending', updated_at_ms: 3 }],
    'the staged encrypted destination remains idempotent and replayable',
  );
});

test('auth wiring chooses handoff only after the new principal is known and logout remains destructive', () => {
  const source = readFileSync(resolve('src/stores/useAuthStore.ts'), 'utf8');
  const api = readFileSync(resolve('src/services/api.ts'), 'utf8');
  const sync = readFileSync(resolve('src/services/invoiceCollectionSync.ts'), 'utf8');
  const destructiveClear = source.slice(
    source.indexOf('async function clearCurrentEncryptedFieldData'),
    source.indexOf('export const useAuthStore'),
  );
  const login = source.slice(source.indexOf('login: async'), source.indexOf('logout: async'));
  const logout = source.slice(source.indexOf('logout: async'));

  assert.match(login, /samePrincipalReauthentication/);
  assert.match(login, /transferCurrentInvoiceCollectionsForReauthentication/);
  assert.match(login, /else\s*\{\s*set\(\{ isAuthenticated: false \}\);\s*await clearCurrentEncryptedFieldData\(\)/);
  assert(login.indexOf('const employeeId') < login.indexOf('samePrincipalReauthentication'));
  assert(login.indexOf('const companyId') < login.indexOf('samePrincipalReauthentication'));
  assert(login.indexOf('const nextSession') < login.indexOf('transferCurrentInvoiceCollectionsForReauthentication'));
  assert(login.indexOf('transferCurrentInvoiceCollectionsForReauthentication') < login.indexOf('clearEncryptedSession'));
  assert.match(login, /clearInvoiceCollectionReauthenticationRequired/);
  assert(
    login.lastIndexOf('clearInvoiceCollectionReauthenticationRequired')
      > login.indexOf('await transferCurrentInvoiceCollectionsForReauthentication'),
    'the old latch clears only after the destination intent transfer is durable',
  );
  assert(
    login.lastIndexOf('resetInvoiceCollectionSync()')
      < login.lastIndexOf('clearReauthenticationLatch:'),
    'the old processor retires before same-principal cleanup can clear its latch',
  );
  assert.match(login, /setAuthTokens\(result\.gf_employee_token, nextSession\.sessionId\)/);
  assert.match(api, /setAuthTokens\(gfToken: string, sessionId = createUuidV4\(\)\)/);
  assert.match(api, /setItemAsync\(STORE_KEYS\.SESSION_ID, sessionId\)/);
  assert.match(logout, /await clearCurrentEncryptedFieldData\(\)/);
  assert.match(destructiveClear, /clearInvoiceCollectionReauthenticationRequired/);
  assert(
    destructiveClear.indexOf('resetInvoiceCollectionSync()')
      < destructiveClear.indexOf('clearReauthenticationLatch:'),
    'logout/account-switch retires old requests before destroying their latch',
  );
  assert(
    destructiveClear.lastIndexOf('clearReauthenticationLatch:')
      > destructiveClear.lastIndexOf('clearEncryptedSession:'),
    'logout/account-switch may clear the latch only after the old intent envelope is gone',
  );
  assert.match(destructiveClear, /finally\s*\{[\s\S]*await clearAuthTokens\(\)/);
  assert.match(destructiveClear, /storeRemoveStrict\(STORAGE_KEYS\.AUTH_STATE\)/);
  assert.match(sync, /await productionRuntimeLifecycle\.suspend\(\)/);
  assert(
    login.indexOf('await storeSaveStrict(STORAGE_KEYS.AUTH_STATE')
      < login.indexOf('await transferCurrentInvoiceCollectionsForReauthentication'),
    'same-principal auth state must be durable before token rotation and intent handoff',
  );
  assert(
    login.lastIndexOf('await storeSaveStrict(STORAGE_KEYS.AUTH_STATE')
      < login.lastIndexOf('resumeInvoiceCollectionSync()'),
    'sync cannot resume before strict auth-state persistence',
  );
  assert.match(login, /persist: \(\) => storeSaveStrict\(STORAGE_KEYS\.AUTH_STATE/);
  assert.match(login, /rollback: async \(\) => \{[\s\S]*await clearCurrentEncryptedFieldData\(\)/);
  assert(
    login.lastIndexOf('resumeInvoiceCollectionSync()') > login.lastIndexOf('setFieldDataIdentity'),
    'sync resumes only after the replacement field identity is installed',
  );
  assert(
    login.lastIndexOf('requestInvoiceCollectionSync()') > login.lastIndexOf('resumeInvoiceCollectionSync()'),
    'the first post-login wake must use the freshly resumed runtime owner',
  );
});
