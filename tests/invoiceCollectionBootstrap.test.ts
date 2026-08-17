import assert from 'node:assert/strict';
import test from 'node:test';

interface BootstrapModule {
  createInvoiceCollectionSyncProcessor(deps: unknown): { reconcile: () => Promise<void> };
  createInvoiceCollectionSyncBootstrap(deps: {
    createProcessor: () => Promise<{ reconcile: () => Promise<void> }>;
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
