import * as SecureStore from 'expo-secure-store';
import {
  decodePendingOperations,
  encodePendingOperations,
  hasPendingOperations,
  type ConsignmentOperationKind,
  type ConsignmentPendingOperations,
  withPendingOperation,
  withoutPendingOperation,
} from './consignmentOperationPersistenceLogic';

/** Encrypted, session-bound idempotency identities for consignment mutations. */
export const CONSIGNMENT_PENDING_OPERATIONS_KEY = 'kf_consignment_pending_operations_v1';

export type { ConsignmentOperationKind, ConsignmentPendingOperations };

export async function loadConsignmentPendingOperations(
  sessionId: string,
): Promise<ConsignmentPendingOperations> {
  const raw = await SecureStore.getItemAsync(CONSIGNMENT_PENDING_OPERATIONS_KEY);
  const operations = decodePendingOperations(raw, sessionId);
  if (operations) return operations;
  if (raw) await SecureStore.deleteItemAsync(CONSIGNMENT_PENDING_OPERATIONS_KEY);
  return {};
}

export async function saveConsignmentPendingOperation(
  sessionId: string,
  kind: ConsignmentOperationKind,
  operationId: string,
): Promise<void> {
  const current = await loadConsignmentPendingOperations(sessionId);
  const next = withPendingOperation(current, kind, operationId);
  await SecureStore.setItemAsync(
    CONSIGNMENT_PENDING_OPERATIONS_KEY,
    encodePendingOperations(sessionId, next),
  );
}

export async function clearConsignmentPendingOperation(
  sessionId: string,
  kind: ConsignmentOperationKind,
): Promise<void> {
  const current = await loadConsignmentPendingOperations(sessionId);
  const next = withoutPendingOperation(current, kind);
  if (!hasPendingOperations(next)) {
    await SecureStore.deleteItemAsync(CONSIGNMENT_PENDING_OPERATIONS_KEY);
    return;
  }
  await SecureStore.setItemAsync(
    CONSIGNMENT_PENDING_OPERATIONS_KEY,
    encodePendingOperations(sessionId, next),
  );
}
