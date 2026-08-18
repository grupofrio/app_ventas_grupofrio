import assert from 'node:assert/strict';
import test from 'node:test';

interface SyncModule {
  classifyInvoiceCollectionError(error: unknown): { kind: string; code?: string; httpStatus?: number };
  isInvoiceCollectionCaptureFailure(error: unknown): error is Error & { durableIntent: boolean };
  createInvoiceCollectionSyncProcessor(deps: unknown): {
    capture(input: unknown): Promise<{ status: string; operationId: string; needsReconciliation?: true }>;
    reconcile(): Promise<void>;
    retire(): Promise<void>;
  };
  createInvoiceCollectionDirectCapture(deps: {
    createProcessor: () => Promise<{ capture(input: unknown): Promise<{ status: string; operationId: string; needsReconciliation?: true }> }>;
  }): (input: unknown) => Promise<{ status: string; operationId: string; needsReconciliation?: true }>;
  createInvoiceCollectionGatedCapture(deps: {
    assertCurrentEmployeeDayBundleAllowsActions: () => Promise<void>;
    createIntent: (input: unknown) => unknown;
    captureIntent: (input: unknown) => Promise<{ status: string; operationId: string }>;
  }): (input: unknown) => Promise<{ status: string; operationId: string; needsReconciliation?: true }>;
  createInvoiceCollectionSyncRuntime(deps: {
    createProcessor: () => Promise<{
      capture(input: unknown): Promise<{ status: string; operationId: string; needsReconciliation?: true }>;
      reconcile(): Promise<void>;
    }>;
  }): {
    capture(input: unknown): Promise<{ status: string; operationId: string; needsReconciliation?: true }>;
    bootstrap(): Promise<void>;
    requestReconnect(): Promise<void>;
  };
  createInvoiceCollectionSyncRuntimeLifecycle<T extends { retire(): Promise<void> }>(
    createRuntime: () => T,
  ): {
    current(): T | null;
    suspend(): Promise<void>;
    resume(): void;
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
    async findOrInsert(item: Record<string, unknown>) {
      const existing = records.find((candidate) => candidate.stop_id === item.stop_id && candidate.invoice_id === item.invoice_id
        && ['dispatching', 'pending', 'review_required'].includes(String(candidate.status)));
      if (existing) return { ...existing };
      records.push({ ...item });
      return { ...item };
    },
    async list() { return records.map((item) => ({ ...item })); },
    async transition(operationId: string, status: string, nowMs: number) {
      const record = records.find((item) => item.operation_id === operationId);
      if (!record) throw new Error('missing intent');
      record.status = status;
      record.updated_at_ms = nowMs;
    },
  };
}

test('direct capture uses its shared processor to persist before the strict collection transport sends', async () => {
  const mod = await loadSync();
  const persistence = createMemoryPersistence();
  const sent: string[] = [];
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 9,
    transport: {
      collect: async (request: { operation_id: string }) => {
        sent.push(request.operation_id);
        return { status: 'applied', operation_id: request.operation_id };
      },
    },
  });
  const directCapture = mod.createInvoiceCollectionDirectCapture({
    createProcessor: async () => processor,
  });

  assert.deepEqual(await directCapture(intent), { status: 'applied', operationId: intent.operation_id });
  assert.deepEqual(sent, [intent.operation_id]);
  assert.deepEqual(persistence.records, [{ ...intent, status: 'applied', updated_at_ms: 9 }]);
});

test('a stale day bundle is a typed non-durable failure before intent creation, encrypted persistence, or transport', async () => {
  const mod = await loadSync();
  let intentCreations = 0;
  let captures = 0;
  const capture = mod.createInvoiceCollectionGatedCapture({
    assertCurrentEmployeeDayBundleAllowsActions: async () => {
      throw new Error('bundle vencido');
    },
    createIntent: () => {
      intentCreations += 1;
      return intent;
    },
    captureIntent: async () => {
      captures += 1;
      return { status: 'applied', operationId: intent.operation_id };
    },
  });

  await assert.rejects(
    () => capture(intent),
    (error: unknown) => {
      assert.equal(mod.isInvoiceCollectionCaptureFailure(error), true);
      assert.equal((error as { durableIntent: boolean }).durableIntent, false);
      assert.match((error as Error).message, /bundle vencido/);
      return true;
    },
  );
  assert.equal(intentCreations, 0);
  assert.equal(captures, 0);
});

test('a second pre-commit intent validation failure is typed and never reaches capture', async () => {
  const mod = await loadSync();
  let captures = 0;
  const capture = mod.createInvoiceCollectionGatedCapture({
    assertCurrentEmployeeDayBundleAllowsActions: async () => {},
    createIntent: () => { throw new Error('snapshot residual inválido'); },
    captureIntent: async () => {
      captures += 1;
      return { status: 'applied', operationId: intent.operation_id };
    },
  });

  await assert.rejects(
    () => capture(intent),
    (error: unknown) => {
      assert.equal(mod.isInvoiceCollectionCaptureFailure(error), true);
      assert.equal((error as { durableIntent: boolean }).durableIntent, false);
      assert.match((error as Error).message, /snapshot residual inválido/);
      return true;
    },
  );
  assert.equal(captures, 0);
});

test('processor initialization failure is typed non-durable and cannot capture an intent', async () => {
  const mod = await loadSync();
  let processorCaptures = 0;
  const directCapture = mod.createInvoiceCollectionDirectCapture({
    createProcessor: async () => {
      processorCaptures += 1;
      throw new Error('SecureStore no disponible');
    },
  });

  await assert.rejects(
    () => directCapture(intent),
    (error: unknown) => {
      assert.equal(mod.isInvoiceCollectionCaptureFailure(error), true);
      assert.equal((error as { durableIntent: boolean }).durableIntent, false);
      assert.match((error as Error).message, /SecureStore no disponible/);
      return true;
    },
  );
  assert.equal(processorCaptures, 1);
});

test('capture arms the shared reconnect runtime so an offline intent replays without restart', async () => {
  const mod = await loadSync();
  const persistence = createMemoryPersistence();
  let online = false;
  const sent: string[] = [];
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => online,
    now: () => 12,
    transport: {
      collect: async (request: { operation_id: string }) => {
        sent.push(request.operation_id);
        return { status: 'applied', operation_id: request.operation_id };
      },
    },
  });
  const runtime = mod.createInvoiceCollectionSyncRuntime({ createProcessor: async () => processor });

  assert.deepEqual(await runtime.capture(intent), { status: 'captured_pending', operationId: intent.operation_id });
  online = true;
  await runtime.requestReconnect();
  assert.deepEqual(sent, [intent.operation_id]);
  assert.equal(persistence.records[0].status, 'applied');
});

test('shared processor initialization clears a rejected promise so capture, bootstrap, and reconnect can retry', async () => {
  const mod = await loadSync();
  let attempts = 0;
  let captures = 0;
  let reconciliations = 0;
  const runtime = mod.createInvoiceCollectionSyncRuntime({
    createProcessor: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('SecureStore temporalmente no disponible');
      return {
        capture: async () => {
          captures += 1;
          return { status: 'applied', operationId: intent.operation_id };
        },
        reconcile: async () => { reconciliations += 1; },
      };
    },
  });

  await assert.rejects(() => runtime.capture(intent), /SecureStore temporalmente no disponible/);
  await runtime.bootstrap();
  await runtime.requestReconnect();
  assert.deepEqual(await runtime.capture(intent), { status: 'applied', operationId: intent.operation_id });
  assert.equal(attempts, 2, 'the settled processor remains shared after the retry');
  assert.equal(reconciliations, 2);
  assert.equal(captures, 1);
});

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

test('an encrypted persistence failure reports a non-durable capture and prevents the first online send', async () => {
  const mod = await loadSync();
  let sends = 0;
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence: {
      async list() { return []; },
      async insert() { throw new Error('encrypted write failed'); },
      async findOrInsert() { throw new Error('encrypted write failed'); },
      async transition() {},
    },
    isOnline: () => true,
    now: () => 30,
    transport: { collect: async () => { sends += 1; return { status: 'applied', operation_id: intent.operation_id }; } },
  });
  await assert.rejects(
    () => processor.capture(intent),
    (error: unknown) => {
      assert.equal(mod.isInvoiceCollectionCaptureFailure(error), true);
      assert.equal((error as { durableIntent: boolean }).durableIntent, false);
      assert.match((error as Error).message, /encrypted write failed/);
      return true;
    },
  );
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

test('concurrent distinct UUID captures reuse one effective intent and one POST', async () => {
  const mod = await loadSync();
  const persistence = createMemoryPersistence();
  const replacement = { ...intent, operation_id: '44444444-2222-4aaa-8bbb-333333333333' };
  let sends = 0;
  let release!: () => void;
  const server = new Promise<{ status: 'applied'; operation_id: string }>((resolve) => {
    release = () => resolve({ status: 'applied', operation_id: intent.operation_id });
  });
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 41,
    transport: { collect: async () => { sends += 1; return server; } },
  });

  const first = processor.capture(intent);
  const second = processor.capture(replacement);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sends, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [
    { status: 'applied', operationId: intent.operation_id },
    { status: 'applied', operationId: intent.operation_id },
  ]);
  assert.deepEqual(persistence.records, [{ ...intent, status: 'applied', updated_at_ms: 41 }]);
});

test('a review-required effective intent never resends for a new UUID', async () => {
  const mod = await loadSync();
  const persistence = createMemoryPersistence([{ ...intent, status: 'review_required' }]);
  let sends = 0;
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 42,
    transport: { collect: async () => { sends += 1; return { status: 'applied', operation_id: intent.operation_id }; } },
  });

  assert.deepEqual(await processor.capture({ ...intent, operation_id: '55555555-2222-4aaa-8bbb-333333333333' }), {
    status: 'review_required', operationId: intent.operation_id,
  });
  assert.equal(sends, 0);
});

test('a failed durable applied acknowledgement reports reconciliation pending without claiming the capture was lost', async () => {
  const mod = await loadSync();
  const records: Record<string, unknown>[] = [{ ...intent }];
  const persistence = {
    async list() { return records.map((item) => ({ ...item })); },
    async insert(item: Record<string, unknown>) { records.push({ ...item }); },
    async findOrInsert(item: Record<string, unknown>) { return { ...item }; },
    async transition() { throw new Error('encrypted acknowledgement write failed'); },
  };
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 42,
    transport: { collect: async () => ({ status: 'applied', operation_id: intent.operation_id }) },
  });

  assert.deepEqual(await processor.capture(intent), {
    status: 'pending', operationId: intent.operation_id, needsReconciliation: true,
  });
  assert.deepEqual(records, [intent]);

  const restartedPersistence = createMemoryPersistence(records);
  const restarted = mod.createInvoiceCollectionSyncProcessor({
    persistence: restartedPersistence,
    isOnline: () => true,
    now: () => 43,
    transport: { collect: async () => ({ status: 'applied', operation_id: intent.operation_id }) },
  });
  await restarted.reconcile();
  assert.deepEqual(restartedPersistence.records, [{ ...intent, status: 'applied', updated_at_ms: 43 }]);
});

test('capture joins an in-flight reconcile replay for its effective UUID', async () => {
  const mod = await loadSync();
  const persistence = createMemoryPersistence([{ ...intent, status: 'pending' }]);
  let sends = 0;
  let resolveFirst!: () => void;
  let rejectSecond: (() => void) | undefined;
  const firstResponse = new Promise<{ status: 'applied'; operation_id: string }>((resolve) => {
    resolveFirst = () => resolve({ status: 'applied', operation_id: intent.operation_id });
  });
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 44,
    transport: {
      collect: async () => {
        if (++sends === 1) return firstResponse;
        return await new Promise<never>((_resolve, reject) => { rejectSecond = () => reject(new Error('network timeout')); });
      },
    },
  });

  const replay = processor.reconcile();
  await Promise.resolve();
  const capture = processor.capture({ ...intent, operation_id: '55555555-2222-4aaa-8bbb-333333333333' });
  await Promise.resolve();
  resolveFirst();
  rejectSecond?.();
  await Promise.all([replay, capture]);

  assert.equal(sends, 1);
  assert.deepEqual(persistence.records, [{ ...intent, status: 'applied', updated_at_ms: 44 }]);
});

test('offline capture does not overwrite an applied reconcile acknowledgement', async () => {
  const mod = await loadSync();
  const persistence = createMemoryPersistence([{ ...intent, status: 'pending' }]);
  let online = true;
  let releaseFind!: () => void;
  const findGate = new Promise<void>((resolve) => { releaseFind = resolve; });
  persistence.findOrInsert = async () => {
    await findGate;
    return { ...persistence.records[0] };
  };
  let releaseServer!: () => void;
  const server = new Promise<{ status: 'applied'; operation_id: string }>((resolve) => {
    releaseServer = () => resolve({ status: 'applied', operation_id: intent.operation_id });
  });
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => online,
    now: () => 45,
    transport: { collect: async () => server },
  });

  const replay = processor.reconcile();
  await new Promise((resolve) => setTimeout(resolve, 0));
  online = false;
  const capture = processor.capture(intent);
  releaseServer();
  await replay;
  releaseFind();

  assert.deepEqual(await capture, { status: 'applied', operationId: intent.operation_id });
  assert.deepEqual(persistence.records, [{ ...intent, status: 'applied', updated_at_ms: 45 }]);
});

test('reconcile skips a stale later row that capture already durably applied', async () => {
  const mod = await loadSync();
  const later = { ...intent, operation_id: '44444444-2222-4aaa-8bbb-333333333333', invoice_id: 9, status: 'pending' };
  const persistence = createMemoryPersistence([{ ...intent, status: 'pending' }, later]);
  const sent: string[] = [];
  let releaseFirst!: () => void;
  const firstResponse = new Promise<{ status: 'applied'; operation_id: string }>((resolve) => {
    releaseFirst = () => resolve({ status: 'applied', operation_id: intent.operation_id });
  });
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 45,
    transport: {
      collect: async (request: { operation_id: string }) => {
        sent.push(request.operation_id);
        return request.operation_id === intent.operation_id
          ? firstResponse
          : { status: 'applied', operation_id: request.operation_id };
      },
    },
  });

  const outerReconcile = processor.reconcile();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, [intent.operation_id]);
  await processor.capture(later);
  releaseFirst();
  await outerReconcile;

  assert.deepEqual(sent, [intent.operation_id, later.operation_id]);
  assert.deepEqual(persistence.records, [
    { ...intent, status: 'applied', updated_at_ms: 45 },
    { ...later, status: 'applied', updated_at_ms: 45 },
  ]);
});

test('authenticated validation failure is terminal review while revoked credentials persist reauth', async () => {
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
  assert.equal(reauthPersistence.records[0].status, 'reauth_required', 'reauth must be durable without changing the UUID or binding');
  assert.equal(reauthPersistence.records[0].operation_id, intent.operation_id);
});

test('durable reauth stops the current pass and a restarted processor without private state sends nothing', async () => {
  const mod = await loadSync();
  const secondIntent = {
    ...intent,
    operation_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    stop_id: 6,
    invoice_id: 9,
  };
  const persistence = createMemoryPersistence([intent, secondIntent]);
  const sent: string[] = [];
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 52,
    transport: {
      collect: async (request: { operation_id: string }) => {
        sent.push(request.operation_id);
        throw { httpStatus: 401, code: 'session_expired', responseReceived: true };
      },
    },
  });

  await processor.reconcile();
  assert.deepEqual(sent, [intent.operation_id], 'the first revoked response must stop this replay pass');

  const restarted = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 53,
    transport: {
      collect: async (request: { operation_id: string }) => {
        sent.push(request.operation_id);
        return { status: 'applied', operation_id: request.operation_id };
      },
    },
  });
  await restarted.reconcile();
  assert.deepEqual(sent, [intent.operation_id], 'persisted reauth must pause a fresh processor before transport');
});

test('a failed reauth marker write fails closed for the rest of the processor lifetime', async () => {
  const mod = await loadSync();
  const secondIntent = {
    ...intent,
    operation_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    stop_id: 6,
    invoice_id: 9,
  };
  const stored = createMemoryPersistence([intent, secondIntent]);
  let latchWriteAttempts = 0;
  const persistence = {
    ...stored,
    async markReauthenticationRequired() {
      latchWriteAttempts += 1;
      throw new Error('independent reauth latch failed');
    },
    async transition(operationId: string, status: string, nowMs: number) {
      if (status === 'reauth_required') throw new Error('encrypted transition failed');
      await stored.transition(operationId, status, nowMs);
    },
  };
  const sent: string[] = [];
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 54,
    transport: {
      collect: async (request: { operation_id: string }) => {
        sent.push(request.operation_id);
        if (request.operation_id === intent.operation_id) {
          throw { httpStatus: 401, code: 'session_expired', responseReceived: true };
        }
        return { status: 'applied', operation_id: request.operation_id };
      },
    },
  });

  await processor.reconcile();
  await processor.reconcile();

  assert.deepEqual(sent, [intent.operation_id], 'a known revoked token must never fail open to another POST');
  assert.equal(latchWriteAttempts, 1, 'the independent durable latch is attempted before relying on memory only');
  assert.equal(stored.records[0].status, 'dispatching', 'the failed encrypted write must not invent durable reauth');
  assert.equal(stored.records[1].status, 'dispatching');
});

test('a retired session processor ignores a late 401 without recreating durable reauth state', async () => {
  const mod = await loadSync();
  const stored = createMemoryPersistence();
  let transitionAttempts = 0;
  let latchWriteAttempts = 0;
  let rejectTransport!: (error: unknown) => void;
  const transportResponse = new Promise<never>((_resolve, reject) => { rejectTransport = reject; });
  const persistence = {
    ...stored,
    async transition(operationId: string, status: string, nowMs: number) {
      transitionAttempts += 1;
      await stored.transition(operationId, status, nowMs);
    },
    async markReauthenticationRequired() {
      latchWriteAttempts += 1;
    },
  };
  const processor = mod.createInvoiceCollectionSyncProcessor({
    persistence,
    isOnline: () => true,
    now: () => 55,
    transport: { collect: async () => transportResponse },
  });

  const capture = processor.capture(intent);
  await Promise.resolve();
  await processor.retire();
  rejectTransport({ httpStatus: 401, code: 'session_expired', responseReceived: true });

  assert.deepEqual(await capture, {
    status: 'pending',
    operationId: intent.operation_id,
    needsReconciliation: true,
  });
  assert.equal(transitionAttempts, 0, 'the destroyed session envelope must stay destroyed');
  assert.equal(latchWriteAttempts, 0, 'the destroyed old-session latch must not be recreated');
});

test('a wake during reset cannot bind a replacement runtime until the new identity resumes sync', async () => {
  const mod = await loadSync();
  let creations = 0;
  let releaseRetirement!: () => void;
  const retirement = new Promise<void>((resolve) => { releaseRetirement = resolve; });
  const lifecycle = mod.createInvoiceCollectionSyncRuntimeLifecycle(() => ({
    id: ++creations,
    async retire() { await retirement; },
  }));

  const oldRuntime = lifecycle.current();
  assert.equal(oldRuntime?.id, 1);
  const reset = lifecycle.suspend();

  assert.equal(lifecycle.current(), null, 'a concurrent connectivity wake must not create against old identity');
  assert.equal(creations, 1);
  releaseRetirement();
  await reset;
  assert.equal(lifecycle.current(), null, 'cleanup remains suspended after old durable writes drain');

  lifecycle.resume();
  const newRuntime = lifecycle.current();
  assert.equal(newRuntime?.id, 2);
  assert.notEqual(newRuntime, oldRuntime);
});
