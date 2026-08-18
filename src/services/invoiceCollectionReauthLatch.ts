import * as SecureStore from 'expo-secure-store';

import { createInvoiceCollectionReauthLatch } from './invoiceCollectionReauthLatchLogic.ts';
import type { EncryptedSessionIdentity } from './encryptedStoreLogic.ts';

const latch = createInvoiceCollectionReauthLatch({
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
});

export function isInvoiceCollectionReauthenticationRequired(
  session: EncryptedSessionIdentity,
): Promise<boolean> {
  return latch.isRequired(session);
}

export function markInvoiceCollectionReauthenticationRequired(
  session: EncryptedSessionIdentity,
): Promise<void> {
  return latch.markRequired(session);
}

export function clearInvoiceCollectionReauthenticationRequired(
  session: EncryptedSessionIdentity,
): Promise<void> {
  return latch.clear(session);
}
