import {
  getEncryptedSessionStorageKey,
  type EncryptedSessionIdentity,
} from './encryptedStoreLogic.ts';

export interface InvoiceCollectionReauthLatchDriver {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface InvoiceCollectionSessionCleanupDeps {
  retireProcessor(): Promise<void>;
  clearPreEnvelopeState?(): Promise<void>;
  clearEncryptedSession(): Promise<void>;
  clearReauthenticationLatch(): Promise<void>;
}

const LATCH_KEY_PREFIX = 'kf-reauth-v1';
const LATCH_VALUE = '1';

function latchKey(session: EncryptedSessionIdentity): string {
  return `${LATCH_KEY_PREFIX}.${getEncryptedSessionStorageKey(session)}`;
}

/** Small credential-state marker; it deliberately carries no collection DTO. */
export function createInvoiceCollectionReauthLatch(driver: InvoiceCollectionReauthLatchDriver) {
  return {
    async isRequired(session: EncryptedSessionIdentity): Promise<boolean> {
      // Any value at this exact session/principal key fails closed. The value
      // has no business fields to parse or trust.
      return (await driver.get(latchKey(session))) !== null;
    },
    markRequired(session: EncryptedSessionIdentity): Promise<void> {
      return driver.set(latchKey(session), LATCH_VALUE);
    },
    clear(session: EncryptedSessionIdentity): Promise<void> {
      return driver.remove(latchKey(session));
    },
  };
}

/**
 * Retire old writes before destructive cleanup, and keep the safety latch until
 * deletion of the encrypted intent envelope has definitely succeeded.
 */
export async function retireAndClearInvoiceCollectionSessionState(
  deps: InvoiceCollectionSessionCleanupDeps,
): Promise<void> {
  await deps.retireProcessor();
  await deps.clearPreEnvelopeState?.();
  await deps.clearEncryptedSession();
  await deps.clearReauthenticationLatch();
}
