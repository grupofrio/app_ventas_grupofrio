import { isSameEncryptedPrincipal, type EncryptedRecordMutator, type EncryptedSessionIdentity } from './encryptedStoreLogic.ts';
import { requestFromIntent, type InvoiceCollectionIntent, type InvoiceCollectionStatus } from './invoiceCollection.ts';

export const INVOICE_COLLECTION_RECORD_KEY = 'invoice-collection:intents';

interface StoredInvoiceCollections {
  version: 1;
  intents: InvoiceCollectionIntent[];
}

export interface InvoiceCollectionPersistenceDeps {
  load: (session: EncryptedSessionIdentity, key: typeof INVOICE_COLLECTION_RECORD_KEY) => Promise<unknown | null>;
  update: (session: EncryptedSessionIdentity, mutator: (api: EncryptedRecordMutator) => void | Promise<void>) => Promise<void>;
  remove?: (session: EncryptedSessionIdentity, key: typeof INVOICE_COLLECTION_RECORD_KEY) => Promise<void>;
}

export interface InvoiceCollectionDurableSummary {
  readonly pendingCount: number;
  readonly reviewRequiredCount: number;
  readonly blockingCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseStored(value: unknown): StoredInvoiceCollections {
  if (value === null) return { version: 1, intents: [] };
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.intents)) throw new Error('Los intents de cobranza cifrados no son válidos.');
  return { version: 1, intents: value.intents.map(validateStoredIntent) };
}

const STORED_INTENT_KEYS = new Set([
  'operation_id', 'stop_id', 'invoice_id', 'amount', 'payment_method',
  'snapshot_residual', 'snapshot_as_of', 'status', 'created_at_ms', 'updated_at_ms',
]);
const STORED_STATUSES = new Set<InvoiceCollectionStatus>(['dispatching', 'pending', 'applied', 'review_required', 'reauth_required']);

function positiveTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Los intents de cobranza cifrados no son válidos.');
  }
  return value;
}

function validateStoredIntent(value: unknown): InvoiceCollectionIntent {
  if (!isRecord(value) || Object.keys(value).some((key) => !STORED_INTENT_KEYS.has(key))) {
    throw new Error('Los intents de cobranza cifrados no son válidos.');
  }
  const request = requestFromIntent(value as unknown as InvoiceCollectionIntent);
  const snapshotResidual = value.snapshot_residual;
  const snapshotAsOf = value.snapshot_as_of;
  const status = value.status;
  const createdAt = positiveTimestamp(value.created_at_ms);
  const updatedAt = positiveTimestamp(value.updated_at_ms);
  if (typeof snapshotResidual !== 'number' || !Number.isFinite(snapshotResidual) || snapshotResidual <= 0
    || request.amount > snapshotResidual
    || (snapshotAsOf !== null && (typeof snapshotAsOf !== 'string' || !snapshotAsOf.trim()))
    || typeof status !== 'string' || !STORED_STATUSES.has(status as InvoiceCollectionStatus)
    || updatedAt < createdAt) {
    throw new Error('Los intents de cobranza cifrados no son válidos.');
  }
  return {
    ...request,
    snapshot_residual: snapshotResidual,
    snapshot_as_of: snapshotAsOf as string | null,
    status: status as InvoiceCollectionStatus,
    created_at_ms: createdAt,
    updated_at_ms: updatedAt,
  };
}

function identicalIntent(a: InvoiceCollectionIntent, b: InvoiceCollectionIntent): boolean {
  return a.operation_id === b.operation_id && a.stop_id === b.stop_id && a.invoice_id === b.invoice_id
    && a.amount === b.amount && a.payment_method === b.payment_method
    && a.snapshot_residual === b.snapshot_residual && a.snapshot_as_of === b.snapshot_as_of;
}

function identicalStoredIntent(a: InvoiceCollectionIntent, b: InvoiceCollectionIntent): boolean {
  return identicalIntent(a, b) && a.status === b.status
    && a.created_at_ms === b.created_at_ms && a.updated_at_ms === b.updated_at_ms;
}

function isNonterminal(intent: InvoiceCollectionIntent): boolean {
  return intent.status === 'dispatching' || intent.status === 'pending'
    || intent.status === 'review_required' || intent.status === 'reauth_required';
}

function summarize(intents: readonly InvoiceCollectionIntent[]): InvoiceCollectionDurableSummary {
  const pendingCount = intents.filter((intent) => intent.status === 'dispatching'
    || intent.status === 'pending' || intent.status === 'reauth_required').length;
  const reviewRequiredCount = intents.filter((intent) => intent.status === 'review_required').length;
  return { pendingCount, reviewRequiredCount, blockingCount: pendingCount + reviewRequiredCount };
}

export function createInvoiceCollectionPersistence(deps: InvoiceCollectionPersistenceDeps) {
  return {
    async list(session: EncryptedSessionIdentity): Promise<InvoiceCollectionIntent[]> {
      return parseStored(await deps.load(session, INVOICE_COLLECTION_RECORD_KEY)).intents.map((intent) => ({ ...intent }));
    },
    async summary(session: EncryptedSessionIdentity): Promise<InvoiceCollectionDurableSummary> {
      return summarize(parseStored(await deps.load(session, INVOICE_COLLECTION_RECORD_KEY)).intents);
    },
    async insert(session: EncryptedSessionIdentity, intent: InvoiceCollectionIntent): Promise<void> {
      const validated = validateStoredIntent(intent);
      await deps.update(session, (api) => {
        const current = parseStored(api.getRecord<unknown>(INVOICE_COLLECTION_RECORD_KEY));
        const existing = current.intents.find((candidate) => candidate.operation_id === validated.operation_id);
        if (existing && !identicalIntent(existing, validated)) throw new Error('operation_id ya pertenece a otro intent de cobranza.');
        if (existing) return;
        api.setRecord(INVOICE_COLLECTION_RECORD_KEY, { version: 1, intents: [...current.intents, validated] });
      });
    },
    async findOrInsert(session: EncryptedSessionIdentity, intent: InvoiceCollectionIntent): Promise<InvoiceCollectionIntent> {
      const validated = validateStoredIntent(intent);
      let effective!: InvoiceCollectionIntent;
      await deps.update(session, (api) => {
        const current = parseStored(api.getRecord<unknown>(INVOICE_COLLECTION_RECORD_KEY));
        const operation = current.intents.find((candidate) => candidate.operation_id === validated.operation_id);
        if (operation) {
          if (!identicalIntent(operation, validated)) throw new Error('operation_id ya pertenece a otro intent de cobranza.');
          effective = { ...operation };
          return;
        }
        const existing = current.intents.find((candidate) => candidate.stop_id === validated.stop_id
          && candidate.invoice_id === validated.invoice_id && isNonterminal(candidate));
        if (existing) {
          effective = { ...existing };
          return;
        }
        effective = validated;
        api.setRecord(INVOICE_COLLECTION_RECORD_KEY, { version: 1, intents: [...current.intents, effective] });
      });
      return effective;
    },
    async transition(
      session: EncryptedSessionIdentity,
      operationId: string,
      status: Extract<InvoiceCollectionStatus, 'pending' | 'applied' | 'review_required' | 'reauth_required'>,
      nowMs: number,
    ): Promise<void> {
      await deps.update(session, (api) => {
        const current = parseStored(api.getRecord<unknown>(INVOICE_COLLECTION_RECORD_KEY));
        const matching = current.intents.filter((intent) => intent.operation_id === operationId);
        if (matching.length === 0) throw new Error('No existe el intent de cobranza.');
        if (matching.length > 1) throw new Error('operation_id pertenece a múltiples intents de cobranza.');
        const intents = current.intents.map((intent) => {
          if (intent.operation_id !== operationId) return intent;
          return { ...intent, status, updated_at_ms: nowMs };
        });
        api.setRecord(INVOICE_COLLECTION_RECORD_KEY, { version: 1, intents });
      });
    },
    async transferForSamePrincipal(
      oldSession: EncryptedSessionIdentity,
      newSession: EncryptedSessionIdentity,
      activateDestination: () => Promise<void>,
    ): Promise<{ transferred: boolean; count: number }> {
      if (!isSameEncryptedPrincipal(oldSession, newSession) || oldSession.sessionId === newSession.sessionId) {
        return { transferred: false, count: 0 };
      }
      if (!deps.remove) throw new Error('La migración cifrada de cobranza no está disponible.');
      const source = parseStored(await deps.load(oldSession, INVOICE_COLLECTION_RECORD_KEY));
      const transferable = source.intents.map((intent) => intent.status === 'reauth_required'
        ? { ...intent, status: 'pending' as const }
        : { ...intent });
      await deps.update(newSession, (api) => {
        const destination = parseStored(api.getRecord<unknown>(INVOICE_COLLECTION_RECORD_KEY));
        const merged = [...destination.intents];
        for (const intent of transferable) {
          const existing = merged.find((candidate) => candidate.operation_id === intent.operation_id);
          if (existing && !identicalStoredIntent(existing, intent)) {
            throw new Error('operation_id ya pertenece a otro intent de cobranza.');
          }
          if (!existing) merged.push({ ...intent });
        }
        api.setRecord(INVOICE_COLLECTION_RECORD_KEY, { version: 1, intents: merged });
      });
      // Keep the old record recoverable until both the destination encrypted
      // write and the new credential/session activation have completed.
      await activateDestination();
      await deps.remove(oldSession, INVOICE_COLLECTION_RECORD_KEY);
      return { transferred: true, count: source.intents.length };
    },
  };
}

/** Production composition stays session-scoped and never touches plaintext storage. */
export async function createCurrentInvoiceCollectionPersistence() {
  const [{ getFieldDataSession }, { loadEncrypted, removeEncrypted, updateEncryptedRecords }] = await Promise.all([
    import('./fieldDataSession.ts'), import('./encryptedStore.ts'),
  ]);
  const session = await getFieldDataSession();
  if (!session) throw new Error('La sesión cifrada de cobranza no está disponible.');
  const persistence = createInvoiceCollectionPersistence({
    load: loadEncrypted,
    update: updateEncryptedRecords,
    remove: removeEncrypted,
  });
  return {
    list: () => persistence.list(session),
    summary: () => persistence.summary(session),
    insert: (intent: InvoiceCollectionIntent) => persistence.insert(session, intent),
    findOrInsert: (intent: InvoiceCollectionIntent) => persistence.findOrInsert(session, intent),
    transition: (operationId: string, status: Extract<InvoiceCollectionStatus, 'pending' | 'applied' | 'review_required' | 'reauth_required'>, nowMs: number) => persistence.transition(session, operationId, status, nowMs),
  };
}

/** Read-only, encrypted closure-gate projection; never creates queue work. */
export async function readCurrentInvoiceCollectionSummary(): Promise<InvoiceCollectionDurableSummary> {
  const persistence = await createCurrentInvoiceCollectionPersistence();
  return persistence.summary();
}

/** Reauth-only encrypted handoff. Cross-principal calls are a no-op. */
export async function transferCurrentInvoiceCollectionsForReauthentication(
  oldSession: EncryptedSessionIdentity,
  newSession: EncryptedSessionIdentity,
  activateDestination: () => Promise<void>,
): Promise<{ transferred: boolean; count: number }> {
  const { loadEncrypted, removeEncrypted, updateEncryptedRecords } = await import('./encryptedStore.ts');
  return createInvoiceCollectionPersistence({
    load: loadEncrypted,
    update: updateEncryptedRecords,
    remove: removeEncrypted,
  }).transferForSamePrincipal(oldSession, newSession, activateDestination);
}
