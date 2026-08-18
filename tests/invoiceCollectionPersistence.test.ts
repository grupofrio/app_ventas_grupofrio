import assert from 'node:assert/strict';
import test from 'node:test';

interface Session {
  companyId: number;
  employeeId: number;
  sessionId: string;
}

interface EncryptedApi {
  getRecord<T>(key: string): T | null;
  setRecord<T>(key: string, value: T): void;
}

interface PersistenceModule {
  INVOICE_COLLECTION_RECORD_KEY: string;
  createInvoiceCollectionPersistence(deps: {
    load: (session: Session, key: string) => Promise<unknown | null>;
    update: (session: Session, mutator: (api: EncryptedApi) => void | Promise<void>) => Promise<void>;
  }): {
    list(session: Session): Promise<Array<{ operation_id: string; status: string }>>;
    insert(session: Session, intent: Record<string, unknown>): Promise<void>;
    findOrInsert(session: Session, intent: Record<string, unknown>): Promise<Record<string, unknown>>;
    transition(session: Session, operationId: string, status: 'pending' | 'applied' | 'review_required' | 'reauth_required', nowMs: number): Promise<void>;
    summary(session: Session): Promise<{
      pendingCount: number;
      reviewRequiredCount: number;
      blockingCount: number;
    }>;
  };
}

async function loadPersistence(): Promise<PersistenceModule> {
  return await import('../src/services/invoiceCollectionPersistence.ts') as unknown as PersistenceModule;
}

function createEncryptedHarness() {
  const records = new Map<string, unknown>();
  let calls = 0;
  return {
    async load(_session: Session, key: string) {
      return records.get(key) ?? null;
    },
    async update(_session: Session, mutator: (api: EncryptedApi) => void | Promise<void>) {
      calls += 1;
      await mutator({
        getRecord: <T>(key: string) => (records.get(key) ?? null) as T | null,
        setRecord: <T>(key: string, value: T) => { records.set(key, value); },
      });
    },
    snapshot: () => structuredClone(records),
    get calls() { return calls; },
  };
}

const session = { companyId: 1, employeeId: 2, sessionId: 'current-session' };
const intent = {
  operation_id: '11111111-2222-4aaa-8bbb-333333333333', stop_id: 5, invoice_id: 8,
  amount: 25, payment_method: 'cash', snapshot_residual: 30, snapshot_as_of: null,
  status: 'dispatching', created_at_ms: 1, updated_at_ms: 1,
};

test('intent writes and state transitions are serialized inside the encrypted session envelope', async () => {
  const mod = await loadPersistence();
  const harness = createEncryptedHarness();
  const store = mod.createInvoiceCollectionPersistence({ load: harness.load, update: harness.update });

  await Promise.all([
    store.insert(session, intent),
    store.insert(session, { ...intent, operation_id: '44444444-2222-4aaa-8bbb-333333333333' }),
  ]);
  await store.transition(session, intent.operation_id, 'pending', 2);

  assert.equal(harness.calls, 3);
  assert.deepEqual(await store.list(session), [
    { ...intent, status: 'pending', updated_at_ms: 2 },
    { ...intent, operation_id: '44444444-2222-4aaa-8bbb-333333333333' },
  ]);
  const envelopeRecord = harness.snapshot().get(mod.INVOICE_COLLECTION_RECORD_KEY) as unknown;
  assert.deepEqual(envelopeRecord, {
    version: 1,
    intents: [
      { ...intent, status: 'pending', updated_at_ms: 2 },
      { ...intent, operation_id: '44444444-2222-4aaa-8bbb-333333333333' },
    ],
  });
});

test('failed durable write exposes no in-memory success and restart rehydrates only persisted intents', async () => {
  const mod = await loadPersistence();
  let fail = true;
  const persisted = new Map<string, unknown>();
  const update = async (_session: Session, mutator: (api: EncryptedApi) => void | Promise<void>) => {
    const staged = new Map(persisted);
    await mutator({
      getRecord: <T>(key: string) => (staged.get(key) ?? null) as T | null,
      setRecord: <T>(key: string, value: T) => { staged.set(key, value); },
    });
    if (fail) throw new Error('encrypted write failed');
    persisted.clear();
    for (const [key, value] of staged) persisted.set(key, value);
  };
  const load = async (_session: Session, key: string) => persisted.get(key) ?? null;
  const firstProcess = mod.createInvoiceCollectionPersistence({ load, update });
  await assert.rejects(() => firstProcess.insert(session, intent), /encrypted write failed/);
  assert.deepEqual(await firstProcess.list(session), []);

  fail = false;
  await firstProcess.insert(session, intent);
  const restarted = mod.createInvoiceCollectionPersistence({ load, update });
  assert.deepEqual(await restarted.list(session), [intent]);
});

test('find-or-insert returns the effective nonterminal intent for one stop and invoice', async () => {
  const mod = await loadPersistence();
  const harness = createEncryptedHarness();
  const store = mod.createInvoiceCollectionPersistence({ load: harness.load, update: harness.update });
  const replacement = { ...intent, operation_id: '44444444-2222-4aaa-8bbb-333333333333' };

  assert.deepEqual(await store.findOrInsert(session, intent), intent);
  assert.deepEqual(await store.findOrInsert(session, replacement), intent, 'dispatching blocks a new UUID');
  await store.transition(session, intent.operation_id, 'pending', 2);
  assert.deepEqual(await store.findOrInsert(session, replacement), { ...intent, status: 'pending', updated_at_ms: 2 });
  await store.transition(session, intent.operation_id, 'reauth_required', 3);
  assert.deepEqual(await store.findOrInsert(session, replacement), { ...intent, status: 'reauth_required', updated_at_ms: 3 });
  await store.transition(session, intent.operation_id, 'review_required', 4);
  assert.deepEqual(await store.findOrInsert(session, replacement), { ...intent, status: 'review_required', updated_at_ms: 4 });
  await store.transition(session, intent.operation_id, 'applied', 5);
  assert.deepEqual(await store.findOrInsert(session, replacement), replacement, 'applied does not block a new collection');
  assert.deepEqual(await store.findOrInsert(session, { ...replacement, operation_id: '55555555-2222-4aaa-8bbb-333333333333', stop_id: 6 }), {
    ...replacement, operation_id: '55555555-2222-4aaa-8bbb-333333333333', stop_id: 6,
  }, 'a different stop does not collide');
});

test('find-or-insert rejects a globally reused UUID with a different immutable binding', async () => {
  const mod = await loadPersistence();
  const harness = createEncryptedHarness();
  const store = mod.createInvoiceCollectionPersistence({ load: harness.load, update: harness.update });
  await store.findOrInsert(session, { ...intent, status: 'applied' });

  await assert.rejects(
    () => store.findOrInsert(session, { ...intent, invoice_id: 9, amount: 24, snapshot_residual: 29 }),
    /operation_id ya pertenece a otro intent de cobranza/,
  );
  await store.transition(session, intent.operation_id, 'pending', 2);
  assert.deepEqual(await store.list(session), [{ ...intent, status: 'pending', updated_at_ms: 2 }]);
});

test('durable summary blocks dispatching, pending, reauth, and review-required collection intents', async () => {
  const mod = await loadPersistence();
  const harness = createEncryptedHarness();
  const store = mod.createInvoiceCollectionPersistence({ load: harness.load, update: harness.update });

  await store.insert(session, intent);
  await store.insert(session, {
    ...intent,
    operation_id: '44444444-2222-4aaa-8bbb-333333333333',
    invoice_id: 9,
    status: 'pending',
  });
  await store.insert(session, {
    ...intent,
    operation_id: '55555555-2222-4aaa-8bbb-333333333333',
    invoice_id: 10,
    status: 'review_required',
  });
  await store.insert(session, {
    ...intent,
    operation_id: '66666666-2222-4aaa-8bbb-333333333333',
    invoice_id: 11,
    status: 'applied',
  });
  await store.insert(session, {
    ...intent,
    operation_id: '77777777-2222-4aaa-8bbb-333333333333',
    invoice_id: 12,
    status: 'reauth_required',
  });

  assert.deepEqual(await store.summary(session), {
    pendingCount: 3,
    reviewRequiredCount: 1,
    blockingCount: 4,
  });
});
