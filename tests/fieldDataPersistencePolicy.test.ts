import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

interface FieldDataPersistenceLogic {
  isEncryptedFieldDataKey(key: string): boolean;
}

async function loadPolicy(): Promise<FieldDataPersistenceLogic> {
  try {
    return await import('../src/services/fieldDataPersistenceLogic.ts') as FieldDataPersistenceLogic;
  } catch {
    assert.fail('field data persistence policy must exist');
  }
}

test('route, visit, catalog, price, directory, and queue records require the encrypted session envelope', async () => {
  const policy = await loadPolicy();
  for (const key of [
    'route:plan',
    'route:stops',
    'route:start',
    'visit:active',
    'cache:products:catalog',
    'cache:prices',
    'cache:consignments',
    'sync:queue',
    'sync:legacyRefreshPending',
  ]) {
    assert.equal(policy.isEncryptedFieldDataKey(key), true, `${key} must be encrypted`);
  }
  assert.equal(policy.isEncryptedFieldDataKey('preferences:thermalPrinter'), false);
  assert.equal(policy.isEncryptedFieldDataKey('auth:state'), false);
});

test('logout and account switching clear the encrypted field-data session before credentials rotate', () => {
  const source = readFileSync(resolve('src/stores/useAuthStore.ts'), 'utf8');
  assert.match(source, /clearEncryptedSession/);
  assert.match(
    source,
    /await clearEncryptedSession\([\s\S]*?await clearAuthTokens\(\)/,
    'logout must erase the encrypted envelope before dropping its session reference',
  );
  assert.match(
    source,
    /await clearEncryptedSession\([\s\S]*?await setAuthTokens\(/,
    'account switch must erase the previous envelope before minting a new session',
  );
  assert.match(
    source,
    /await clearSensitiveFieldData\(\)[\s\S]*?await clearAuthTokens\(\)/,
    'logout must erase every legacy plaintext field-data key before dropping its session reference',
  );
  assert.match(
    source,
    /await clearSensitiveFieldData\(\)[\s\S]*?await setAuthTokens\(/,
    'account switching must not leave a prior employee record in AsyncStorage',
  );
});

test('plaintext storage only removes legacy field data and never writes protected records', () => {
  const source = readFileSync(resolve('src/persistence/storage.ts'), 'utf8');
  assert.match(source, /isEncryptedFieldDataKey/);
  assert.match(source, /AsyncStorage\.removeItem/);
  assert.match(source, /saveEncrypted/);
  assert.doesNotMatch(source, /AsyncStorage\.setItem\(`\$\{PREFIX\}\$\{STORAGE_KEYS\.SYNC_QUEUE\}/);
});

test('global persistence clearing also erases the active encrypted field-data envelope', () => {
  const source = readFileSync(resolve('src/persistence/storage.ts'), 'utf8');
  const clearBlock = source.match(/export async function storeClear\(\): Promise<void> \{[\s\S]*?\n\}/);
  assert(clearBlock, 'storeClear must exist');
  assert.match(clearBlock[0], /clearEncryptedSession/);
});

test('legacy sensitive plaintext cleanup is a bounded erase-only operation', () => {
  const source = readFileSync(resolve('src/persistence/storage.ts'), 'utf8');
  const clearBlock = source.match(
    /export async function clearSensitiveFieldData\(\): Promise<void> \{[\s\S]*?\n\}/,
  );
  assert(clearBlock, 'bounded legacy field-data cleanup must exist');
  assert.match(clearBlock[0], /ENCRYPTED_FIELD_DATA_KEYS/);
  assert.match(clearBlock[0], /AsyncStorage\.multiRemove/);
  assert.doesNotMatch(
    clearBlock[0],
    /AsyncStorage\.getItem/,
    'legacy cleanup must erase plaintext rather than migrate it into a later session',
  );
});

test('account changes discard the in-memory sync queue before a new session can persist it', () => {
  const syncStore = readFileSync(resolve('src/stores/useSyncStore.ts'), 'utf8');
  const authStore = readFileSync(resolve('src/stores/useAuthStore.ts'), 'utf8');
  assert.match(syncStore, /resetForSessionChange:/);
  assert.match(syncStore, /resetForSessionChange:[\s\S]*?queue: \[\]/);
  assert.match(authStore, /useSyncStore\.getState\(\)\.resetForSessionChange\(\)/);
});
