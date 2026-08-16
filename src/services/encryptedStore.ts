/**
 * Native encrypted persistence for session-scoped KOLD Field data.
 *
 * The backing module uses encrypted native storage suitable for complete day
 * bundles and queues. Expo SecureStore remains limited to small credentials;
 * it is deliberately not used for these potentially large records.
 */

import * as SecureStorage from '@pagopa/io-react-native-secure-storage';

import {
  createEncryptedSessionStore,
  type EncryptedSessionIdentity,
  type EncryptedStorageDriver,
} from './encryptedStoreLogic.ts';

function isValueNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'message' in error
    && (error as { message?: unknown }).message === 'VALUE_NOT_FOUND';
}

const nativeEncryptedDriver: EncryptedStorageDriver = {
  async get(key) {
    try {
      return await SecureStorage.get(key);
    } catch (error) {
      if (isValueNotFound(error)) return null;
      throw error;
    }
  },
  put: (key, value) => SecureStorage.put(key, value),
  async remove(key) {
    try {
      await SecureStorage.remove(key);
    } catch (error) {
      // Logout/account-switch cleanup is idempotent: a missing envelope is
      // already the desired state, while every other native failure remains
      // observable to the caller.
      if (!isValueNotFound(error)) throw error;
    }
  },
};

const encryptedSessionStore = createEncryptedSessionStore(nativeEncryptedDriver);

export type { EncryptedSessionIdentity } from './encryptedStoreLogic.ts';

export function saveEncrypted<T>(
  sessionKey: EncryptedSessionIdentity,
  key: string,
  value: T,
): Promise<void> {
  return encryptedSessionStore.save(sessionKey, key, value);
}

export function loadEncrypted<T>(
  sessionKey: EncryptedSessionIdentity,
  key: string,
): Promise<T | null> {
  return encryptedSessionStore.load<T>(sessionKey, key);
}

export function removeEncrypted(
  sessionKey: EncryptedSessionIdentity,
  key: string,
): Promise<void> {
  return encryptedSessionStore.remove(sessionKey, key);
}

export function clearEncryptedSession(
  sessionKey: EncryptedSessionIdentity,
): Promise<void> {
  return encryptedSessionStore.clear(sessionKey);
}
