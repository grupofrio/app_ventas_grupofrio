import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

type OperationKind = 'create' | 'visit' | 'close';

interface PendingOperations {
  create?: string;
  visit?: string;
  close?: string;
}

interface PersistenceLogic {
  decodePendingOperations(raw: string | null, sessionId: string): PendingOperations | null;
  parsePendingOperations(value: unknown): PendingOperations | null;
  withPendingOperation(
    operations: PendingOperations,
    kind: OperationKind,
    operationId: string,
  ): PendingOperations;
  withoutPendingOperation(operations: PendingOperations, kind: OperationKind): PendingOperations;
}

interface EncryptedSessionStore {
  clear(session: { companyId: number; employeeId: number; sessionId: string }): Promise<void>;
  load<T>(session: { companyId: number; employeeId: number; sessionId: string }, key: string): Promise<T | null>;
  save<T>(session: { companyId: number; employeeId: number; sessionId: string }, key: string, value: T): Promise<void>;
}

interface EncryptedStoreLogic {
  createEncryptedSessionStore(driver: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  }): EncryptedSessionStore;
}

async function loadPersistenceLogic(): Promise<PersistenceLogic> {
  try {
    return await import('../src/services/consignmentOperationPersistenceLogic.ts') as PersistenceLogic;
  } catch {
    assert.fail('consignment pending-operation persistence logic must exist');
  }
}

async function loadEncryptedStoreLogic(): Promise<EncryptedStoreLogic> {
  return await import('../src/services/encryptedStoreLogic.ts') as EncryptedStoreLogic;
}

test('consignment operation ids survive restart only within the authenticated session', async () => {
  const persistence = await loadPersistenceLogic();
  const afterCreate = persistence.withPendingOperation(
    {},
    'create',
    '01234567-89ab-4cde-8fab-0123456789ab',
  );
  const afterVisit = persistence.withPendingOperation(
    afterCreate,
    'visit',
    'fedcba98-7654-4321-8fed-cba987654321',
  );
  const serialized = JSON.stringify({ version: 1, sessionId: 'session-a', operations: afterVisit });

  assert.deepEqual(persistence.decodePendingOperations(serialized, 'session-a'), afterVisit);
  assert.equal(persistence.decodePendingOperations(serialized, 'session-b'), null);
  assert.equal(persistence.decodePendingOperations('{not-json', 'session-a'), null);
});

test('consignment operation identity remains until its matching confirmed success', async () => {
  const persistence = await loadPersistenceLogic();
  const pending = persistence.withPendingOperation(
    { create: '01234567-89ab-4cde-8fab-0123456789ab' },
    'close',
    'fedcba98-7654-4321-8fed-cba987654321',
  );

  assert.deepEqual(persistence.withoutPendingOperation(pending, 'visit'), pending);
  assert.deepEqual(persistence.withoutPendingOperation(pending, 'close'), {
    create: '01234567-89ab-4cde-8fab-0123456789ab',
  });
});

test('encrypted pending-operation records reject malformed values before a retry can use them', async () => {
  const persistence = await loadPersistenceLogic();

  assert.deepEqual(
    persistence.parsePendingOperations({ create: '01234567-89ab-4cde-8fab-0123456789ab' }),
    { create: '01234567-89ab-4cde-8fab-0123456789ab' },
  );
  assert.equal(persistence.parsePendingOperations({ create: '' }), null);
  assert.equal(persistence.parsePendingOperations({ visit: 123 }), null);
});

test('consignment retry ids survive a same-session restart but disappear immediately for logout or account switch', async () => {
  const logic = await loadEncryptedStoreLogic();
  const records = new Map<string, string>();
  const driver = {
    get: async (key: string) => records.get(key) ?? null,
    put: async (key: string, value: string) => { records.set(key, value); },
    remove: async (key: string) => { records.delete(key); },
  };
  const current = { companyId: 7, employeeId: 42, sessionId: 'session-a' };
  const switched = { ...current, employeeId: 43, sessionId: 'session-b' };
  const record = 'consignment:pendingOperations';

  await logic.createEncryptedSessionStore(driver).save(current, record, {
    create: '01234567-89ab-4cde-8fab-0123456789ab',
  });
  const afterRestart = logic.createEncryptedSessionStore(driver);
  assert.deepEqual(await afterRestart.load(current, record), {
    create: '01234567-89ab-4cde-8fab-0123456789ab',
  });
  assert.equal(await afterRestart.load(switched, record), null);

  await afterRestart.clear(current);
  assert.equal(await afterRestart.load(current, record), null);
});

test('consignment pending ids use the encrypted session envelope, not a global SecureStore record', () => {
  let source = '';
  try {
    source = readFileSync(resolve('src/services/consignmentOperationPersistence.ts'), 'utf8');
  } catch {
    assert.fail('consignment pending-operation encrypted storage module must exist');
  }
  assert.match(source, /loadEncrypted/, 'pending ids must be loaded from the encrypted session envelope');
  assert.match(source, /saveEncrypted/, 'pending ids must be saved into the encrypted session envelope');
  assert.match(source, /removeEncrypted/, 'empty pending state must remove its encrypted envelope record');
  assert.doesNotMatch(source, /SecureStore\.getItemAsync|SecureStore\.setItemAsync/,
    'pending ids must not be read or written through the former global SecureStore record');
  assert.doesNotMatch(source, /AsyncStorage/, 'pending operation ids must never use plaintext AsyncStorage');
});

test('logout and account switches immediately delete the former global consignment pending-id record', () => {
  const authStore = readFileSync(resolve('src/stores/useAuthStore.ts'), 'utf8');
  assert.match(authStore, /clearLegacyConsignmentPendingOperations/);
  assert.match(
    authStore,
    /await clearLegacyConsignmentPendingOperations\(\)[\s\S]*?await clearEncryptedSession\(/,
    'legacy cleanup must run even if clearing the current native envelope later fails',
  );
  assert.match(
    authStore,
    /await clearLegacyConsignmentPendingOperations\(\)[\s\S]*?await clearAuthTokens\(\)/,
    'logout must clear the old global record before its session credential disappears',
  );
  assert.match(
    authStore,
    /await clearLegacyConsignmentPendingOperations\(\)[\s\S]*?await setAuthTokens\(/,
    'account switching must clear the old global record before the new employee session starts',
  );
});

test('consignment persists an operation id before dispatch and clears it only after success', () => {
  const screen = readFileSync(resolve('app/consignment/[stopId].tsx'), 'utf8');

  assert.match(screen, /await getConsignmentPendingOperationId\('create'\)/, 'create must persist or restore its id before dispatch');
  assert.match(screen, /await clearConsignmentPendingOperationId\('create'\)/, 'create clears only after its request resolves');
  assert.match(screen, /await getConsignmentPendingOperationId\(closing \? 'close' : 'visit'\)/, 'visit/close must restore their operation ids before dispatch');
  assert.match(screen, /await clearConsignmentPendingOperationId\(closing \? 'close' : 'visit'\)/, 'visit/close clear only after their request resolves');
});
