import {
  loadEncrypted,
  removeEncrypted,
  saveEncrypted,
} from './encryptedStore.ts';
import { getFieldDataSession } from './fieldDataSession.ts';
import {
  createOpenNoSaleIntent,
  noSaleIntentRecordKey,
  parseNoSaleIntent,
  type NoSaleIntentKeyParts,
  type NoSaleIntentState,
  type NoSaleIntentV1,
} from './noSaleOperationPersistenceLogic.ts';

export type { NoSaleIntentV1, NoSaleIntentKeyParts };

export async function loadNoSaleIntent(
  parts: NoSaleIntentKeyParts,
): Promise<NoSaleIntentV1 | null> {
  const session = await getFieldDataSession();
  if (!session) return null;
  const key = noSaleIntentRecordKey(parts);
  const stored = await loadEncrypted<unknown>(session, key);
  if (stored === null) return null;
  const parsed = parseNoSaleIntent(stored);
  if (!parsed) {
    await removeEncrypted(session, key);
    return null;
  }
  return parsed;
}

export async function persistOpenNoSaleIntent(input: {
  stopId: number;
  planId: number | null;
  operationalDate: string | null;
  reasonCode: string;
  reasonId: number | null;
  notes: string;
  competitor: string | null;
  photoUris: string[];
  /** When rehydrating / retrying, force this UUID. */
  operationId?: string;
}): Promise<NoSaleIntentV1> {
  const session = await getFieldDataSession();
  if (!session) {
    throw new Error('No hay sesión cifrada para persistir la no-venta.');
  }
  const parts: NoSaleIntentKeyParts = {
    operationalDate: input.operationalDate,
    planId: input.planId,
    stopId: input.stopId,
  };
  const existing = await loadNoSaleIntent(parts);
  const reuseOpen = existing?.state === 'open';
  const operationId = input.operationId
    ?? (reuseOpen ? existing.operation_id : undefined);

  const intent = createOpenNoSaleIntent({
    stopId: input.stopId,
    planId: input.planId,
    operationalDate: input.operationalDate,
    reasonCode: input.reasonCode,
    reasonId: input.reasonId,
    notes: input.notes,
    competitor: input.competitor,
    photoUris: input.photoUris,
    operationId,
  });

  const toSave: NoSaleIntentV1 = reuseOpen && existing.operation_id === intent.operation_id
    ? { ...intent, created_at: existing.created_at, updated_at: new Date().toISOString() }
    : intent;

  await saveEncrypted(session, noSaleIntentRecordKey(parts), toSave);
  return toSave;
}

export async function retireNoSaleIntent(
  parts: NoSaleIntentKeyParts,
  _state: Extract<NoSaleIntentState, 'completed' | 'rejected'>,
): Promise<void> {
  const session = await getFieldDataSession();
  if (!session) return;
  await removeEncrypted(session, noSaleIntentRecordKey(parts));
}
