import {
  loadEncrypted,
  removeEncrypted,
  saveEncrypted,
} from './encryptedStore.ts';
import { getFieldDataSession } from './fieldDataSession.ts';
import {
  createOpenNoSaleIntent,
  assertNoSaleIntentCanOpen,
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
  latitude?: number | null;
  longitude?: number | null;
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
  assertNoSaleIntentCanOpen(existing);
  const reuseOpen = existing?.state === 'open';
  // An unresolved UUID binds the original payload. A later edit must never
  // reuse that UUID with different reason/evidence after a lost response.
  if (reuseOpen && existing) return existing;
  const operationId = input.operationId
    ?? undefined;

  const intent = createOpenNoSaleIntent({
    stopId: input.stopId,
    planId: input.planId,
    operationalDate: input.operationalDate,
    reasonCode: input.reasonCode,
    reasonId: input.reasonId,
    notes: input.notes,
    competitor: input.competitor,
    photoUris: input.photoUris,
    latitude: input.latitude,
    longitude: input.longitude,
    operationId,
  });

  await saveEncrypted(session, noSaleIntentRecordKey(parts), intent);
  return intent;
}

/** Preserve the exact no-sale evidence for human reconciliation; never delete it. */
export async function markNoSaleIntentReviewRequired(
  parts: NoSaleIntentKeyParts,
): Promise<void> {
  const session = await getFieldDataSession();
  if (!session) {
    throw new Error('No hay sesión cifrada para conservar la no-venta pendiente de revisión.');
  }
  const existing = await loadNoSaleIntent(parts);
  if (!existing) {
    throw new Error('No existe evidencia de no-venta para conservar en revisión.');
  }
  await saveEncrypted(session, noSaleIntentRecordKey(parts), {
    ...existing,
    state: 'review_required',
    updated_at: new Date().toISOString(),
  });
}

export async function retireNoSaleIntent(
  parts: NoSaleIntentKeyParts,
  _state: Extract<NoSaleIntentState, 'completed' | 'rejected'>,
): Promise<void> {
  const session = await getFieldDataSession();
  if (!session) return;
  await removeEncrypted(session, noSaleIntentRecordKey(parts));
}
