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
    transition(session: Session, operationId: string, status: 'pending' | 'applied' | 'review_required', nowMs: number): Promise<void>;
    transferForSamePrincipal(
      oldSession: Session,
      newSession: Session,
      activateDestination: () => Promise<void>,
    ): Promise<{
      transferred: boolean;
      count: number;
    }>;
  };
}

interface SyncModule {
  createInvoiceCollectionSyncProcessor(deps: unknown): {
    capture(intent: Record<string, unknown>): Promise<{ status: string; operationId: string }>;
    reconcile(): Promise<void>;
  };
}

const oldSession = { companyId: 7, employeeId: 19, sessionId: 'old-session' };
const newSession = { companyId: 7, employeeId: 19, sessionId: 'new-session' };
const intent = {
  operation_id: '11111111-2222-4aaa-8bbb-333333333333', stop_id: 5, invoice_id: 8,
  amount: 25, payment_method: 'cash', snapshot_residual: 30, snapshot_as_of: null,
  status: 'pending', created_at_ms: 1, updated_at_ms: 2,
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

test('same employee and company reauthentication transfers the encrypted UUID and restart replays it', async () => {
  const persistenceModule = await import('../src/services/invoiceCollectionPersistence.ts') as unknown as PersistenceModule;
  const syncModule = await import('../src/services/invoiceCollectionSync.ts') as unknown as SyncModule;
  const harness = createEncryptedHarness();
  const persistence = persistenceModule.createInvoiceCollectionPersistence(harness);
  let revokedAttempts = 0;

  const beforeReauthentication = syncModule.createInvoiceCollectionSyncProcessor({
    persistence: {
      list: () => persistence.list(oldSession),
      insert: (candidate: Record<string, unknown>) => persistence.insert(oldSession, candidate),
      findOrInsert: (candidate: Record<string, unknown>) => persistence.findOrInsert(oldSession, candidate),
      transition: (operationId: string, status: 'pending' | 'applied' | 'review_required', nowMs: number) =>
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
  assert.deepEqual(await beforeReauthentication.capture(intent), {
    status: 'reauth_required',
    operationId: intent.operation_id,
    code: 'token_revoked',
    httpStatus: 401,
  });
  assert.deepEqual(await persistence.list(oldSession), [intent], '401 must leave the original durable UUID untouched');
  await beforeReauthentication.reconcile();
  assert.equal(revokedAttempts, 1, 'a reconnect before successful login must not POST with revoked credentials');

  let activated = false;
  assert.deepEqual(await persistence.transferForSamePrincipal(oldSession, newSession, async () => {
    activated = true;
  }), {
    transferred: true,
    count: 1,
  });
  assert.equal(activated, true);
  assert.deepEqual(await persistence.list(oldSession), [], 'old copy is deleted only after the new copy commits');
  assert.deepEqual(await persistence.list(newSession), [intent]);

  const sent: string[] = [];
  const restarted = syncModule.createInvoiceCollectionSyncProcessor({
    persistence: {
      list: () => persistence.list(newSession),
      insert: (candidate: Record<string, unknown>) => persistence.insert(newSession, candidate),
      findOrInsert: async (candidate: Record<string, unknown>) => candidate,
      transition: (operationId: string, status: 'pending' | 'applied' | 'review_required', nowMs: number) =>
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

test('account switch never transfers invoice collection data and destructive cleanup removes the old record', async () => {
  const persistenceModule = await import('../src/services/invoiceCollectionPersistence.ts') as unknown as PersistenceModule;
  const harness = createEncryptedHarness();
  const persistence = persistenceModule.createInvoiceCollectionPersistence(harness);
  const otherPrincipal = { companyId: 7, employeeId: 20, sessionId: 'other-session' };

  await persistence.insert(oldSession, intent);
  assert.deepEqual(await persistence.transferForSamePrincipal(oldSession, otherPrincipal, async () => {
    assert.fail('cross-principal handoff must not activate the destination session');
  }), {
    transferred: false,
    count: 0,
  });
  assert.deepEqual(await persistence.list(otherPrincipal), []);
  assert.deepEqual(await persistence.list(oldSession), [intent], 'a rejected handoff must not delete evidence itself');

  harness.clear(oldSession);
  assert.deepEqual(await persistence.list(oldSession), [], 'the existing account-switch cleanup remains destructive');
});

test('failed destination-session activation keeps the old encrypted copy recoverable', async () => {
  const persistenceModule = await import('../src/services/invoiceCollectionPersistence.ts') as unknown as PersistenceModule;
  const harness = createEncryptedHarness();
  const persistence = persistenceModule.createInvoiceCollectionPersistence(harness);

  await persistence.insert(oldSession, intent);
  await assert.rejects(
    () => persistence.transferForSamePrincipal(oldSession, newSession, async () => {
      throw new Error('SecureStore rotation failed');
    }),
    /SecureStore rotation failed/,
  );

  assert.deepEqual(await persistence.list(oldSession), [intent]);
  assert.deepEqual(await persistence.list(newSession), [intent], 'the staged encrypted destination remains idempotent');
});

test('auth wiring chooses handoff only after the new principal is known and logout remains destructive', () => {
  const source = readFileSync(resolve('src/stores/useAuthStore.ts'), 'utf8');
  const api = readFileSync(resolve('src/services/api.ts'), 'utf8');
  const login = source.slice(source.indexOf('login: async'), source.indexOf('logout: async'));
  const logout = source.slice(source.indexOf('logout: async'));

  assert.match(login, /samePrincipalReauthentication/);
  assert.match(login, /transferCurrentInvoiceCollectionsForReauthentication/);
  assert.match(login, /else\s*\{\s*await clearCurrentEncryptedFieldData\(\)/);
  assert(login.indexOf('const employeeId') < login.indexOf('samePrincipalReauthentication'));
  assert(login.indexOf('const companyId') < login.indexOf('samePrincipalReauthentication'));
  assert(login.indexOf('const nextSession') < login.indexOf('transferCurrentInvoiceCollectionsForReauthentication'));
  assert(login.indexOf('transferCurrentInvoiceCollectionsForReauthentication') < login.indexOf('clearEncryptedSession'));
  assert.match(login, /setAuthTokens\(result\.gf_employee_token, nextSession\.sessionId\)/);
  assert.match(api, /setAuthTokens\(gfToken: string, sessionId = createUuidV4\(\)\)/);
  assert.match(api, /setItemAsync\(STORE_KEYS\.SESSION_ID, sessionId\)/);
  assert.match(logout, /await clearCurrentEncryptedFieldData\(\)/);
});
