import assert from 'node:assert/strict';
import test from 'node:test';

import { recoverPersistedSaleIntent } from '../src/services/saleRehydrateRecovery.ts';
import type { SaleRecoveryIntentV1 } from '../src/services/saleRecoveryIntent.ts';
import type { SyncEnqueueOptions, SyncItemType } from '../src/types/sync.ts';

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
