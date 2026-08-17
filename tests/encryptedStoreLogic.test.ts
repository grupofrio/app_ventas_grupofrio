import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface SecureStorageDriver {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

interface SessionIdentity {
  companyId: number;
  employeeId: number;
  /** A non-secret session reference; never the Bearer token. */
  sessionId: string;
}

interface EncryptedSessionStore {
  clear(session: SessionIdentity): Promise<void>;
  load<T>(session: SessionIdentity, key: string): Promise<T | null>;
  remove(session: SessionIdentity, key: string): Promise<void>;
  save<T>(session: SessionIdentity, key: string, value: T): Promise<void>;
}

interface EncryptedStoreLogic {
  createEncryptedSessionStore(driver: SecureStorageDriver): EncryptedSessionStore;
  getEncryptedSessionStorageKey(session: SessionIdentity): string;
  assertEncryptedRecord(key: string, storage: 'encrypted' | 'plaintext'): void;
}

async function loadEncryptedStoreLogic(): Promise<EncryptedStoreLogic> {
  try {
    return await import('../src/services/encryptedStoreLogic.ts') as EncryptedStoreLogic;
  } catch {
    assert.fail('encrypted session storage logic must exist');
  }
}

function createMemoryDriver(): SecureStorageDriver & { readonly writes: string[] } {
  const records = new Map<string, string>();
  const writes: string[] = [];
  return {
    writes,
    async get(key) {
      return records.get(key) ?? null;
    },
    async put(key, value) {
      writes.push(key);
      records.set(key, value);
    },
    async remove(key) {
      records.delete(key);
    },
  };
}

const firstSession: SessionIdentity = {
  companyId: 7,
  employeeId: 42,
  sessionId: 'session-reference-2026-08-14',
};

test('encrypted session storage derives a non-secret namespace for each identity', async () => {
  const storage = await loadEncryptedStoreLogic();
  const firstKey = storage.getEncryptedSessionStorageKey(firstSession);
  const secondKey = storage.getEncryptedSessionStorageKey({
    ...firstSession,
    employeeId: 43,
  });

  assert.match(firstKey, /^kf-field-v1\./);
  assert.notEqual(firstKey, secondKey);
  assert.doesNotMatch(firstKey, /session-reference-2026-08-14/);
  assert.doesNotMatch(firstKey, /Bearer|token/i);
});

test('encrypted session storage atomically replaces and reloads a complete record', async () => {
  const storage = await loadEncryptedStoreLogic();
  const driver = createMemoryDriver();
  const store = storage.createEncryptedSessionStore(driver);

  await store.save(firstSession, 'day-bundle', {
    version: 1,
    stops: [{ id: 101 }],
  });
  await store.save(firstSession, 'day-bundle', {
    version: 2,
    stops: [{ id: 202 }],
  });

  assert.deepEqual(
    await store.load(firstSession, 'day-bundle'),
    { version: 2, stops: [{ id: 202 }] },
  );
  assert.equal(driver.writes.length, 2, 'each complete envelope update is one native write');
});

test('encrypted session storage removes a record and clears only the logged-out identity', async () => {
  const storage = await loadEncryptedStoreLogic();
  const driver = createMemoryDriver();
  const store = storage.createEncryptedSessionStore(driver);
  const switchedAccount = { ...firstSession, employeeId: 43 };

  await store.save(firstSession, 'sync-queue', [{ operationId: 'op-a' }]);
  await store.save(switchedAccount, 'sync-queue', [{ operationId: 'op-b' }]);
  await store.remove(firstSession, 'sync-queue');
  assert.equal(await store.load(firstSession, 'sync-queue'), null);

  await store.save(firstSession, 'day-bundle', { planId: 10 });
  await store.clear(firstSession);

  assert.equal(await store.load(firstSession, 'day-bundle'), null);
  assert.deepEqual(await store.load(switchedAccount, 'sync-queue'), [{ operationId: 'op-b' }]);
});

test('bundle and queue records reject plaintext persistence', async () => {
  const storage = await loadEncryptedStoreLogic();

  assert.throws(
    () => storage.assertEncryptedRecord('day-bundle', 'plaintext'),
    /must use encrypted storage/i,
  );
  assert.throws(
    () => storage.assertEncryptedRecord('sync-queue', 'plaintext'),
    /must use encrypted storage/i,
  );
  assert.throws(
    () => storage.assertEncryptedRecord('inventory-ledger', 'plaintext'),
    /must use encrypted storage/i,
  );
  assert.throws(
    () => storage.assertEncryptedRecord('invoice-collection:intents', 'plaintext'),
    /must use encrypted storage/i,
  );
  assert.doesNotThrow(() => storage.assertEncryptedRecord('thermal-printer', 'plaintext'));
  assert.doesNotThrow(() => storage.assertEncryptedRecord('day-bundle', 'encrypted'));
  assert.doesNotThrow(() => storage.assertEncryptedRecord('inventory-ledger', 'encrypted'));
  assert.doesNotThrow(() => storage.assertEncryptedRecord('invoice-collection:intents', 'encrypted'));
});

test('Android backups are disabled for the native encrypted field store', () => {
  const appConfig = JSON.parse(readFileSync('app.json', 'utf8')) as {
    expo?: { android?: { allowBackup?: boolean } };
  };
  assert.equal(appConfig.expo?.android?.allowBackup, false);
});
