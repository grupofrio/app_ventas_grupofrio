import assert from 'node:assert/strict';
import test from 'node:test';

interface BootstrapModule {
  createInvoiceCollectionSyncProcessor(deps: unknown): {
    capture(input: unknown): Promise<{ status: string; operationId: string }>;
    reconcile(): Promise<void>;
  };
  createInvoiceCollectionSyncBootstrap(deps: {
    createProcessor: () => Promise<{ reconcile: () => Promise<void> }>;
  }): {
    bootstrap(): Promise<void>;
    requestReconnect(): Promise<void>;
  };
  createInvoiceCollectionSyncRuntime(deps: {
    createProcessor: () => Promise<{
      capture(input: unknown): Promise<{ status: string; operationId: string }>;
      reconcile(): Promise<void>;
    }>;
  }): {
    bootstrap(): Promise<void>;
    requestReconnect(): Promise<void>;
  };
}

async function loadBootstrap(): Promise<BootstrapModule> {
  return await import('../src/services/invoiceCollectionSync.ts') as BootstrapModule;
}

test('startup rehydrates one processor and the existing reconnect wake replays its durable intent', async () => {
  const mod = await loadBootstrap();
  let online = false;
  let creates = 0;
  let replays = 0;
  const bootstrap = mod.createInvoiceCollectionSyncBootstrap({
    createProcessor: async () => {
      creates += 1;
      return {
        async reconcile() {
          if (online) replays += 1;
        },
      };
    },
  });

  await bootstrap.bootstrap();
  assert.equal(creates, 1);
  assert.equal(replays, 0, 'offline restart retains the durable intent without sending it');

  online = true;
  await bootstrap.requestReconnect();
  assert.equal(creates, 1, 'reconnect reuses the one collection processor');
  assert.equal(replays, 1, 'reconnect dispatches the rehydrated durable intent');
});

test('a durable offline intent survives restart and is sent by the reconnect wake with its original UUID', async () => {
  const mod = await loadBootstrap();
  const durable = [{
    operation_id: '11111111-2222-4aaa-8bbb-333333333333', stop_id: 5, invoice_id: 8,
    amount: 25, payment_method: 'cash', snapshot_residual: 30, snapshot_as_of: null,
    status: 'pending', created_at_ms: 1, updated_at_ms: 1,
  }];
  let online = false;
  const sent: string[] = [];
  const persistence = {
    async list() { return durable.map((item) => ({ ...item })); },
    async insert() {},
    async transition(operationId: string, status: string, nowMs: number) {
      const stored = durable.find((item) => item.operation_id === operationId)!;
      stored.status = status;
      stored.updated_at_ms = nowMs;
    },
  };
  const bootstrap = mod.createInvoiceCollectionSyncBootstrap({
    createProcessor: async () => mod.createInvoiceCollectionSyncProcessor({
      persistence,
      isOnline: () => online,
      now: () => 2,
      transport: {
        collect: async (request: { operation_id: string }) => {
          sent.push(request.operation_id);
          return { status: 'applied', operation_id: request.operation_id };
        },
      },
    }),
  });

  await bootstrap.bootstrap();
  assert.deepEqual(sent, []);
  assert.equal(durable[0].status, 'pending');
  online = true;
  await bootstrap.requestReconnect();
  assert.deepEqual(sent, ['11111111-2222-4aaa-8bbb-333333333333']);
  assert.equal(durable[0].status, 'applied');
});

test('unknown or offline startup returns without transport, then confirmed reconnect uses the same processor', async () => {
  const mod = await loadBootstrap();
  const durable = [{
    operation_id: '11111111-2222-4aaa-8bbb-333333333333', stop_id: 5, invoice_id: 8,
    amount: 25, payment_method: 'cash', snapshot_residual: 30, snapshot_as_of: null,
    status: 'pending', created_at_ms: 1, updated_at_ms: 1,
  }];
  let confirmedOnline = false;
  let creates = 0;
  const sent: string[] = [];
  let releaseTransport!: () => void;
  const transport = new Promise<{ status: 'applied'; operation_id: string }>((resolve) => {
    releaseTransport = () => resolve({ status: 'applied', operation_id: durable[0].operation_id });
  });
  const runtime = mod.createInvoiceCollectionSyncRuntime({
    createProcessor: async () => {
      creates += 1;
      return mod.createInvoiceCollectionSyncProcessor({
        persistence: {
          async list() { return durable.map((item) => ({ ...item })); },
          async insert() {},
          async findOrInsert(candidate: unknown) { return candidate; },
          async transition(operationId: string, status: string, nowMs: number) {
            const stored = durable.find((item) => item.operation_id === operationId)!;
            stored.status = status;
            stored.updated_at_ms = nowMs;
          },
        },
        isOnline: () => confirmedOnline,
        now: () => 2,
        transport: {
          collect: async (request: { operation_id: string }) => {
            sent.push(request.operation_id);
            return transport;
          },
        },
      });
    },
  });

  const startup = await Promise.race([
    runtime.bootstrap().then(() => 'ready' as const),
    new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 25)),
  ]);
  assert.equal(startup, 'ready', 'critical rehydration must not wait on the mutation timeout');
  assert.deepEqual(sent, []);

  confirmedOnline = true;
  const reconnect = runtime.requestReconnect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, [durable[0].operation_id]);
  releaseTransport();
  await reconnect;
  assert.equal(creates, 1, 'startup and connectivity wake share one processor');
});
