import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('production reauth latch uses independent SecureStore and composes into every current-session read', () => {
  const nativePath = 'src/services/invoiceCollectionReauthLatch.ts';
  assert.equal(existsSync(nativePath), true, 'the production SecureStore latch composition must exist');
  const native = readFileSync(nativePath, 'utf8');
  const persistence = readFileSync('src/services/invoiceCollectionPersistence.ts', 'utf8');
  const sync = readFileSync('src/services/invoiceCollectionSync.ts', 'utf8');

  assert.match(native, /from 'expo-secure-store'/);
  assert.doesNotMatch(native, /from '\.\/encryptedStore\.ts'|AsyncStorage|invoice_id|operation_id|amount|payment_method/);
  assert.match(persistence, /import\('\.\/invoiceCollectionReauthLatch\.ts'\)/);
  assert.match(persistence, /createInvoiceCollectionReauthAwarePersistence\(\{/);
  assert.match(persistence, /markRequired: \(\) => markInvoiceCollectionReauthenticationRequired\(session\)/);
  assert.match(sync, /await deps\.persistence\.markReauthenticationRequired\?\.\(\)/);
});
