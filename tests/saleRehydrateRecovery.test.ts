import assert from 'node:assert/strict';
import test from 'node:test';

import { recoverPersistedSaleIntent } from '../src/services/saleRehydrateRecovery.ts';
import type { SaleRecoveryIntentV1 } from '../src/services/saleRecoveryIntent.ts';
import { rearmSaleOrderForRetry } from '../src/services/saleRetry.ts';
import type {
  SyncEnqueueOptions,
  SyncItemType,
  SyncQueueItem,
} from '../src/types/sync.ts';

const intent: SaleRecoveryIntentV1 = {
  version: 1,
  operationId: 'sale-op-crash',
  queuePayload: {
    _operationId: 'sale-op-crash',
    partner_id: 501,
    stop_id: 44,
    lines: [{ product_id: 7, quantity: 2 }],
    _clientCustomerName: 'Abarrotes Lupita',
    _clientTotal: 100,
  },
  stopId: 44,
  photoUris: ['file://sale-1.jpg', 'file://sale-2.jpg'],
  ticketSnapshot: {
    saleId: 'sale-op-crash',
    customerName: 'Abarrotes Lupita',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    paymentLabel: 'Efectivo',
    createdAt: '2026-07-21T10:00:00.000Z',
    lines: [],
    subtotal: 100,
    total: 100,
    totalKg: 10,
  },
};

test('crash recovery materializes the exact sale id, payload, and photos durably', async () => {
  const calls: Array<{
    type: SyncItemType;
    payload: Record<string, unknown>;
    options?: SyncEnqueueOptions;
  }> = [];
  const events: string[] = [];

  const result = await recoverPersistedSaleIntent({
    saleConfirmed: true,
    saleReadyToContinue: false,
    intent,
    queue: [],
    enqueue: (type, payload, options) => {
      calls.push({ type, payload, options });
      return type === 'sale_order' ? 'sale-op-crash' : `photo-${calls.length - 1}`;
    },
    persistQueue: async () => { events.push('persist'); },
    releaseProcessingHolds: (ids) => { events.push(`release:${ids.join(',')}`); },
    saveTicket: async (ticket) => {
      events.push(`ticket:${ticket.saleId}`);
    },
  });

  assert.equal(result.status, 'materialized');
  assert.equal(calls[0].type, 'sale_order');
  assert.deepEqual(calls[0].payload, intent.queuePayload);
  assert.equal(calls[0].options?.operationId, intent.operationId);
  assert.deepEqual(calls.slice(1).map((call) => call.payload.localUri), intent.photoUris);
  assert.equal(events[0], 'persist');
  assert.match(events[1], /^release:sale-op-crash,/);
  assert.equal(events[2], 'ticket:sale-op-crash');
});

test('crash recovery skips duplicate enqueue when any matching sale already exists', async () => {
  let enqueueCalls = 0;
  let persistCalls = 0;
  let ticketCalls = 0;

  const result = await recoverPersistedSaleIntent({
    saleConfirmed: true,
    saleReadyToContinue: false,
    intent,
    queue: [{ id: intent.operationId, type: 'sale_order', status: 'error' }],
    enqueue: () => { enqueueCalls++; return 'unexpected'; },
    persistQueue: async () => { persistCalls++; },
    releaseProcessingHolds: () => {},
    saveTicket: async () => { ticketCalls++; },
  });

  assert.equal(result.status, 'already_queued');
  assert.equal(enqueueCalls, 0);
  assert.equal(persistCalls, 0);
  assert.equal(ticketCalls, 1);
});

test('restart keeps a protected dead sale and its original photo dependencies without duplicates', async () => {
  const queue: SyncQueueItem[] = [
    {
      id: intent.operationId,
      type: 'sale_order',
      payload: { ...intent.queuePayload },
      status: 'dead',
      created_at: 1,
      retries: 1,
      error_message: 'Producto sin existencia',
      error_code: 'insufficient_stock',
      priority: 1,
      next_retry_at: null,
    },
    {
      id: 'photo-original-1',
      type: 'photo',
      payload: { localUri: intent.photoUris[0] },
      status: 'dead',
      created_at: 2,
      retries: 1,
      error_message: 'Parent operation failed',
      priority: 2,
      next_retry_at: null,
      dependsOn: [intent.operationId],
    },
    {
      id: 'photo-original-2',
      type: 'photo',
      payload: { localUri: intent.photoUris[1] },
      status: 'dead',
      created_at: 3,
      retries: 1,
      error_message: 'Parent operation failed',
      priority: 2,
      next_retry_at: null,
      dependsOn: [intent.operationId],
    },
  ];
  let enqueueCalls = 0;
  let persistCalls = 0;

  const recovered = await recoverPersistedSaleIntent({
    saleConfirmed: true,
    saleReadyToContinue: false,
    intent,
    queue,
    enqueue: () => { enqueueCalls += 1; return 'unexpected'; },
    persistQueue: async () => { persistCalls += 1; },
    releaseProcessingHolds: () => {},
    saveTicket: async () => {},
  });
  const retried = rearmSaleOrderForRetry(queue, intent.operationId);

  assert.deepEqual(recovered, { status: 'already_queued' });
  assert.equal(enqueueCalls, 0, 'restart must not enqueue another sale or photos');
  assert.equal(persistCalls, 0, 'an unchanged protected queue needs no rewrite');
  assert.deepEqual(
    retried.map((item) => ({
      id: item.id,
      status: item.status,
      dependsOn: item.dependsOn,
    })),
    [
      { id: intent.operationId, status: 'pending', dependsOn: undefined },
      { id: 'photo-original-1', status: 'pending', dependsOn: [intent.operationId] },
      { id: 'photo-original-2', status: 'pending', dependsOn: [intent.operationId] },
    ],
    'explicit retry must preserve the exact operation id and dependency series',
  );
});

test('restart safely ignores hostile queue rows before a matching protected sale', async () => {
  const hostile = new Proxy({}, {
    get() {
      throw new Error('hostile persisted row');
    },
  });
  let enqueueCalls = 0;

  const recovered = await recoverPersistedSaleIntent({
    saleConfirmed: true,
    saleReadyToContinue: false,
    intent,
    queue: [
      hostile as never,
      {
        id: intent.operationId,
        type: 'sale_order',
        status: 'dead',
        error_code: ' INSUFFICIENT_STOCK ',
      } as never,
    ],
    enqueue: () => { enqueueCalls += 1; return 'unexpected'; },
    persistQueue: async () => {},
    releaseProcessingHolds: () => {},
    saveTicket: async () => {},
  });

  assert.deepEqual(recovered, { status: 'already_queued' });
  assert.equal(enqueueCalls, 0);
});

test('an ordinary dead sale keeps legacy rematerialization semantics', async () => {
  const calls: SyncItemType[] = [];

  const recovered = await recoverPersistedSaleIntent({
    saleConfirmed: true,
    saleReadyToContinue: false,
    intent,
    queue: [{
      id: intent.operationId,
      type: 'sale_order',
      status: 'dead',
      error_code: 'validation_error',
    } as never],
    enqueue: (type) => {
      calls.push(type);
      return type === 'sale_order' ? intent.operationId : `photo-${calls.length}`;
    },
    persistQueue: async () => {},
    releaseProcessingHolds: () => {},
    saveTicket: async () => {},
  });

  assert.deepEqual(recovered, { status: 'materialized' });
  assert.deepEqual(calls, ['sale_order', 'photo', 'photo']);
});

test('ticket persistence is best effort after durable recovery', async () => {
  await assert.doesNotReject(recoverPersistedSaleIntent({
    saleConfirmed: true,
    saleReadyToContinue: false,
    intent,
    queue: [{ id: intent.operationId, type: 'sale_order', status: 'pending' }],
    enqueue: () => 'unexpected',
    persistQueue: async () => {},
    releaseProcessingHolds: () => {},
    saveTicket: async () => { throw new Error('ticket disk full'); },
  }));
});
