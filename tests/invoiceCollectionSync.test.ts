import assert from 'node:assert/strict';
import test from 'node:test';

interface SyncModule {
  classifyInvoiceCollectionError(error: unknown): { kind: string; code?: string; httpStatus?: number };
  createInvoiceCollectionSyncProcessor(deps: unknown): {
    capture(input: unknown): Promise<{ status: string; operationId: string }>;
    reconcile(): Promise<void>;
  };
}

async function loadSync(): Promise<SyncModule> {
  return await import('../src/services/invoiceCollectionSync.ts') as SyncModule;
}

const intent = {
  operation_id: '11111111-2222-4aaa-8bbb-333333333333', stop_id: 5, invoice_id: 8,
  amount: 25, payment_method: 'cash', snapshot_residual: 30, snapshot_as_of: null,
  status: 'dispatching', created_at_ms: 1, updated_at_ms: 1,
};

function createMemoryPersistence(initial: Record<string, unknown>[] = []) {
  const records = initial.map((item) => ({ ...item }));
  return {
    records,
    async insert(item: Record<string, unknown>) { records.push({ ...item }); },
    async list() { return records.map((item) => ({ ...item })); },
    async transition(operationId: string, status: string, nowMs: number) {
      const record = records.find((item) => item.operation_id === operationId);
      if (!record) throw new Error('missing intent');
      record.status = status;
      record.updated_at_ms = nowMs;
    },
  };
}

test('online capture durably writes dispatching before send and response loss keeps its UUID for restart replay', async () => {
  const mod = await loadSync();
  const persistence = createMemoryPersistence();
  const sent: string[] = [];
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 10,
    transport: {
      collect: async (request: { operation_id: string }) => {
        sent.push(request.operation_id);
        throw new Error('network timeout after commit');
      },
    },
  });

  const captured = await processor.capture(intent);
  assert.deepEqual(captured, { status: 'pending', operationId: intent.operation_id });
  assert.deepEqual(sent, [intent.operation_id]);
  assert.deepEqual(persistence.records, [{ ...intent, status: 'pending', updated_at_ms: 10 }]);

  const restarted = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 11,
    transport: { collect: async (request: { operation_id: string }) => ({ status: 'applied', operation_id: request.operation_id }) },
  });
  await restarted.reconcile();
  assert.deepEqual(persistence.records, [{ ...intent, status: 'applied', updated_at_ms: 11 }]);
});

test('offline capture is durable pending and review-required never retries', async () => {
  const mod = await loadSync();
  const persistence = createMemoryPersistence();
  let sends = 0;
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => false,
    now: () => 20,
    transport: { collect: async () => { sends += 1; return { status: 'review_required' }; } },
  });
  assert.deepEqual(await processor.capture(intent), { status: 'captured_pending', operationId: intent.operation_id });
  assert.equal(sends, 0);
  assert.deepEqual(persistence.records, [{ ...intent, status: 'pending', updated_at_ms: 20 }]);

  const online = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 21,
    transport: { collect: async () => { sends += 1; return { status: 'review_required' }; } },
  });
  await Promise.all([online.reconcile(), online.reconcile()]);
  assert.equal(sends, 1, 'concurrent reconcilers share one replay');
  assert.deepEqual(persistence.records, [{ ...intent, status: 'review_required', updated_at_ms: 21 }]);
  await online.reconcile();
  assert.equal(sends, 1, 'review-required records are terminal');
});

test('an encrypted persistence failure prevents the first online send', async () => {
  const mod = await loadSync();
  let sends = 0;
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence: {
      async list() { return []; },
      async insert() { throw new Error('encrypted write failed'); },
      async transition() {},
    },
    isOnline: () => true,
    now: () => 30,
    transport: { collect: async () => { sends += 1; return { status: 'applied', operation_id: intent.operation_id }; } },
  });
  await assert.rejects(() => processor.capture(intent), /encrypted write failed/);
  assert.equal(sends, 0);
});

test('double tap shares one in-flight capture for the original UUID', async () => {
  const mod = await loadSync();
  const persistence = createMemoryPersistence();
  let sends = 0;
  let release!: () => void;
  const server = new Promise<{ status: 'applied'; operation_id: string }>((resolve) => {
    release = () => resolve({ status: 'applied', operation_id: intent.operation_id });
  });
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 40,
    transport: { collect: async () => { sends += 1; return server; } },
  });
  const first = processor.capture(intent);
  const second = processor.capture(intent);
  await Promise.resolve();
  assert.equal(sends, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [
    { status: 'applied', operationId: intent.operation_id },
    { status: 'applied', operationId: intent.operation_id },
  ]);
});

test('authenticated validation failure is terminal review while revoked credentials stay unchanged for reauth', async () => {
  const mod = await loadSync();
  assert.deepEqual(
    mod.classifyInvoiceCollectionError({ httpStatus: 422, code: 'validation_error', responseReceived: true }),
    { kind: 'review_required', code: 'validation_error', httpStatus: 422 },
  );
  assert.deepEqual(
    mod.classifyInvoiceCollectionError({ httpStatus: 401, code: 'session_expired', responseReceived: true }),
    { kind: 'reauth_required', code: 'session_expired', httpStatus: 401 },
  );
  assert.deepEqual(
    mod.classifyInvoiceCollectionError({ code: 'timeout', responseReceived: false }),
    { kind: 'pending', code: 'timeout' },
  );
  assert.deepEqual(
    mod.classifyInvoiceCollectionError({ httpStatus: 408, code: 'request_timeout', responseReceived: true }),
    { kind: 'pending', code: 'request_timeout', httpStatus: 408 },
  );
  assert.deepEqual(
    mod.classifyInvoiceCollectionError({ httpStatus: 429, code: 'rate_limit', responseReceived: true }),
    { kind: 'pending', code: 'rate_limit', httpStatus: 429 },
  );

  const persistence = createMemoryPersistence();
  const reviewProcessor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 50,
    transport: { collect: async () => { throw { httpStatus: 422, code: 'invoice_scope_denied', responseReceived: true }; } },
  });
  assert.deepEqual(await reviewProcessor.capture(intent), {
    status: 'review_required', operationId: intent.operation_id, code: 'invoice_scope_denied', httpStatus: 422,
  });
  assert.equal(persistence.records[0].status, 'review_required');

  const reauthPersistence = createMemoryPersistence();
  const reauthProcessor = mod.createInvoiceCollectionSyncProcessor({
    persistence: reauthPersistence,
    isOnline: () => true,
    now: () => 51,
    transport: { collect: async () => { throw { httpStatus: 401, code: 'session_expired', responseReceived: true }; } },
  });
  assert.deepEqual(await reauthProcessor.capture(intent), {
    status: 'reauth_required', operationId: intent.operation_id, code: 'session_expired', httpStatus: 401,
  });
  assert.equal(reauthPersistence.records[0].status, 'dispatching', 'reauth must not mutate the encrypted intent');
});
