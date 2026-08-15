import * as SecureStore from 'expo-secure-store';
import {
  hasPendingOperations,
  parsePendingOperations,
  type ConsignmentOperationKind,
  type ConsignmentPendingOperations,
  withPendingOperation,
  withoutPendingOperation,
} from './consignmentOperationPersistenceLogic';
import {
  loadEncrypted,
  removeEncrypted,
  saveEncrypted,
  type EncryptedSessionIdentity,
} from './encryptedStore';

/** One-time cleanup target for the pre-session-envelope implementation. */
export const CONSIGNMENT_PENDING_OPERATIONS_KEY = 'kf_consignment_pending_operations_v1';
const CONSIGNMENT_PENDING_OPERATIONS_RECORD = 'consignment:pendingOperations';

export type { ConsignmentOperationKind, ConsignmentPendingOperations };

/**
 * The former SecureStore record was global to the install. Never read or
 * migrate it: logout/account-switch cleanup erases it before credentials
 * rotate, so a prior employee's idempotency key cannot reappear later.
 */
export function clearLegacyConsignmentPendingOperations(): Promise<void> {
  return SecureStore.deleteItemAsync(CONSIGNMENT_PENDING_OPERATIONS_KEY);
}

export async function loadConsignmentPendingOperations(
  session: EncryptedSessionIdentity,
): Promise<ConsignmentPendingOperations> {
  const stored = await loadEncrypted<unknown>(
    session,
    CONSIGNMENT_PENDING_OPERATIONS_RECORD,
  );
  if (stored === null) return {};
  const operations = parsePendingOperations(stored);
  if (operations) return operations;
  await removeEncrypted(session, CONSIGNMENT_PENDING_OPERATIONS_RECORD);
  return {};
}

export async function saveConsignmentPendingOperation(
  session: EncryptedSessionIdentity,
  kind: ConsignmentOperationKind,
  operationId: string,
): Promise<void> {
  const current = await loadConsignmentPendingOperations(session);
  const next = withPendingOperation(current, kind, operationId);
  await saveEncrypted(session, CONSIGNMENT_PENDING_OPERATIONS_RECORD, next);
}

export async function clearConsignmentPendingOperation(
  session: EncryptedSessionIdentity,
  kind: ConsignmentOperationKind,
): Promise<void> {
  const current = await loadConsignmentPendingOperations(session);
  const next = withoutPendingOperation(current, kind);
  if (!hasPendingOperations(next)) {
    await removeEncrypted(session, CONSIGNMENT_PENDING_OPERATIONS_RECORD);
    return;
  }
  await saveEncrypted(session, CONSIGNMENT_PENDING_OPERATIONS_RECORD, next);
}
