import type { EncryptedRecordMutator, EncryptedSessionIdentity } from './encryptedStoreLogic.ts';
import type { InvoiceCollectionIntent, InvoiceCollectionStatus } from './invoiceCollection.ts';

export const INVOICE_COLLECTION_RECORD_KEY = 'invoice-collection:intents';

interface StoredInvoiceCollections {
  version: 1;
  intents: InvoiceCollectionIntent[];
}

export interface InvoiceCollectionPersistenceDeps {
  load: (session: EncryptedSessionIdentity, key: typeof INVOICE_COLLECTION_RECORD_KEY) => Promise<unknown | null>;
  update: (session: EncryptedSessionIdentity, mutator: (api: EncryptedRecordMutator) => void | Promise<void>) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseStored(value: unknown): StoredInvoiceCollections {
  if (value === null) return { version: 1, intents: [] };
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.intents)) throw new Error('Los intents de cobranza cifrados no son válidos.');
  return { version: 1, intents: value.intents as InvoiceCollectionIntent[] };
}

function identicalIntent(a: InvoiceCollectionIntent, b: InvoiceCollectionIntent): boolean {
  return a.operation_id === b.operation_id && a.stop_id === b.stop_id && a.invoice_id === b.invoice_id
    && a.amount === b.amount && a.payment_method === b.payment_method
    && a.snapshot_residual === b.snapshot_residual && a.snapshot_as_of === b.snapshot_as_of;
}

function isNonterminal(intent: InvoiceCollectionIntent): boolean {
  return intent.status === 'dispatching' || intent.status === 'pending' || intent.status === 'review_required';
}

export function createInvoiceCollectionPersistence(deps: InvoiceCollectionPersistenceDeps) {
  return {
    async list(session: EncryptedSessionIdentity): Promise<InvoiceCollectionIntent[]> {
      return parseStored(await deps.load(session, INVOICE_COLLECTION_RECORD_KEY)).intents.map((intent) => ({ ...intent }));
    },
    async insert(session: EncryptedSessionIdentity, intent: InvoiceCollectionIntent): Promise<void> {
      await deps.update(session, (api) => {
        const current = parseStored(api.getRecord<unknown>(INVOICE_COLLECTION_RECORD_KEY));
        const existing = current.intents.find((candidate) => candidate.operation_id === intent.operation_id);
        if (existing && !identicalIntent(existing, intent)) throw new Error('operation_id ya pertenece a otro intent de cobranza.');
        if (existing) return;
        api.setRecord(INVOICE_COLLECTION_RECORD_KEY, { version: 1, intents: [...current.intents, { ...intent }] });
      });
    },
    async findOrInsert(session: EncryptedSessionIdentity, intent: InvoiceCollectionIntent): Promise<InvoiceCollectionIntent> {
      let effective!: InvoiceCollectionIntent;
      await deps.update(session, (api) => {
        const current = parseStored(api.getRecord<unknown>(INVOICE_COLLECTION_RECORD_KEY));
        const operation = current.intents.find((candidate) => candidate.operation_id === intent.operation_id);
        if (operation) {
          if (!identicalIntent(operation, intent)) throw new Error('operation_id ya pertenece a otro intent de cobranza.');
          effective = { ...operation };
          return;
        }
        const existing = current.intents.find((candidate) => candidate.stop_id === intent.stop_id
          && candidate.invoice_id === intent.invoice_id && isNonterminal(candidate));
        if (existing) {
          effective = { ...existing };
          return;
        }
        effective = { ...intent };
        api.setRecord(INVOICE_COLLECTION_RECORD_KEY, { version: 1, intents: [...current.intents, effective] });
      });
      return effective;
    },
    async transition(
      session: EncryptedSessionIdentity,
      operationId: string,
      status: Extract<InvoiceCollectionStatus, 'pending' | 'applied' | 'review_required'>,
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
  };
}

/** Production composition stays session-scoped and never touches plaintext storage. */
export async function createCurrentInvoiceCollectionPersistence() {
  const [{ getFieldDataSession }, { loadEncrypted, updateEncryptedRecords }] = await Promise.all([
    import('./fieldDataSession.ts'), import('./encryptedStore.ts'),
  ]);
  const session = await getFieldDataSession();
  if (!session) throw new Error('La sesión cifrada de cobranza no está disponible.');
  const persistence = createInvoiceCollectionPersistence({ load: loadEncrypted, update: updateEncryptedRecords });
  return {
    list: () => persistence.list(session),
    insert: (intent: InvoiceCollectionIntent) => persistence.insert(session, intent),
    findOrInsert: (intent: InvoiceCollectionIntent) => persistence.findOrInsert(session, intent),
    transition: (operationId: string, status: Extract<InvoiceCollectionStatus, 'pending' | 'applied' | 'review_required'>, nowMs: number) => persistence.transition(session, operationId, status, nowMs),
  };
}
