import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { GFSalesOrder } from '../src/services/gfLogistics.ts';
import type { SaleTicketSnapshot } from '../src/services/saleTicket.ts';
import {
  mergeSalesListEntries,
  type SalesListEntry,
} from '../src/services/salesListProjection.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';

const servicePath = fileURLToPath(
  new URL('../src/services/completedSaleRetention.ts', import.meta.url),
);
assert.equal(
  existsSync(servicePath),
  true,
  'completedSaleRetention debe existir para probar la retención real',
);

const { reconcileCompletedSaleRetention } = await import(
  '../src/services/completedSaleRetention.ts'
);

function queueItem(
  id: string,
  overrides: Partial<SyncQueueItem> = {},
): SyncQueueItem {
  return {
    id,
    type: 'sale_order',
    payload: {
      _clientCustomerName: 'Cliente desde cola',
      _clientTotal: 91,
      lines: [{ quantity: 2, weight: 4 }],
    },
    status: 'done',
    created_at: new Date(2026, 6, 25, 11, 0, 0).getTime(),
    retries: 0,
    error_message: null,
    priority: 1,
    next_retry_at: null,
    ...overrides,
  };
}

function localEntry(
  operationId = 'sale-a',
  overrides: Partial<SalesListEntry> = {},
): SalesListEntry {
  return {
    key: `local:${operationId}`,
    operationId,
    origin: 'local',
    customerName: 'Cliente con ticket',
    amountTotal: 125,
    kgTotal: 25,
    createdAtMs: new Date(2026, 6, 25, 10, 30, 0).getTime(),
    localStatus: 'pending',
    errorMessage: null,
    ...overrides,
  };
}

function remoteOrder(
  operationId: string,
  overrides: Partial<GFSalesOrder> = {},
): GFSalesOrder {
  return {
    id: 77,
    name: 'SO77',
    partner_id: 4,
    partner_name: 'Cliente Odoo',
    amount_total: 125,
    amount_untaxed: 107.76,
    amount_tax: 17.24,
    kg_total: 25,
    state: 'sale',
    date_order: '2026-07-25T10:31:00-06:00',
    confirmation_date: '2026-07-25T10:31:00-06:00',
    stop_id: 3,
    operation_id: operationId,
    payment_method: 'cash',
    payment_method_label: 'Efectivo',
    employee_name: 'Vendedor',
    lines: [],
    ...overrides,
  };
}

function visibleRemoteEntries(
  remoteOrders: GFSalesOrder[],
  localDay = '2026-07-25',
): SalesListEntry[] {
  return mergeSalesListEntries({
    remoteOrders,
    localEntries: [],
    localDay,
  });
}

function ticket(
  saleId: string,
  overrides: Partial<SaleTicketSnapshot> = {},
): SaleTicketSnapshot {
  return {
    saleId,
    origin: 'local',
    customerName: 'Cliente recuperado',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    paymentLabel: 'Efectivo',
    createdAt: '2026-07-25T16:45:00.000Z',
    lines: [],
    subtotal: 140,
    total: 140,
    totalKg: 28,
    ...overrides,
  };
}

test('retains the last local projection as updating across pending to done', () => {
  const previous = localEntry();

  const retained = reconcileCompletedSaleRetention({
    retainedCompletedEntries: new Map(),
    previousLocalEntries: [previous],
    queue: [queueItem('sale-a')],
    tickets: new Map(),
    remoteEntries: [],
  });

  assert.deepEqual([...retained.keys()], ['sale-a']);
  assert.deepEqual(retained.get('sale-a'), {
    ...previous,
    localStatus: 'updating',
    errorMessage: null,
  });
  assert.notStrictEqual(retained.get('sale-a'), previous);
  assert.equal(previous.localStatus, 'pending');
});

test('keeps a completed projection when refresh failed or remote data is stale', () => {
  const updating = localEntry('sale-a', { localStatus: 'updating' });
  const original = new Map([['sale-a', updating]]);

  const retained = reconcileCompletedSaleRetention({
    retainedCompletedEntries: original,
    previousLocalEntries: [],
    queue: [],
    tickets: new Map(),
    remoteEntries: visibleRemoteEntries([remoteOrder('another-sale')]),
  });

  assert.deepEqual(retained.get('sale-a'), updating);
  assert.notStrictEqual(retained, original);
});

test('purges the completed projection when the normalized Odoo operation appears', () => {
  const retained = reconcileCompletedSaleRetention({
    retainedCompletedEntries: new Map([
      ['sale-a', localEntry('sale-a', { localStatus: 'updating' })],
    ]),
    previousLocalEntries: [],
    queue: [queueItem('sale-a')],
    tickets: new Map(),
    remoteEntries: visibleRemoteEntries([remoteOrder('  SALE-A  ')]),
  });

  assert.equal(retained.size, 0);
});

test('derives a valid done sale on mount from its persisted ticket', () => {
  const retained = reconcileCompletedSaleRetention({
    retainedCompletedEntries: new Map(),
    previousLocalEntries: [],
    queue: [queueItem(' sale-mounted ')],
    tickets: new Map([
      [' sale-mounted ', ticket('sale-mounted')],
    ]),
    remoteEntries: [],
  });

  assert.deepEqual(retained.get('sale-mounted'), {
    key: 'local:sale-mounted',
    operationId: 'sale-mounted',
    origin: 'local',
    customerName: 'Cliente recuperado',
    amountTotal: 140,
    kgTotal: 28,
    createdAtMs: Date.parse('2026-07-25T16:45:00.000Z'),
    localStatus: 'updating',
    errorMessage: null,
  });
});

test('does not create ghosts for unrelated, blank, or already remote queue items', () => {
  const retained = reconcileCompletedSaleRetention({
    retainedCompletedEntries: new Map(),
    previousLocalEntries: [],
    queue: [
      queueItem('visit', { type: 'checkout' }),
      queueItem('   '),
      queueItem('sale-active', { status: 'pending' }),
      queueItem('sale-remote'),
    ],
    tickets: new Map(),
    remoteEntries: visibleRemoteEntries([remoteOrder('sale-remote')]),
  });

  assert.equal(retained.size, 0);
});

test('does not mutate queue, prior entries, tickets, or remote orders', () => {
  const queue = [queueItem('sale-a')];
  const previous = [localEntry()];
  const retainedInput = new Map<string, SalesListEntry>();
  const tickets = new Map([['sale-a', ticket('sale-a')]]);
  const remoteOrders = [remoteOrder('other')];
  const queueBefore = structuredClone(queue);
  const previousBefore = structuredClone(previous);
  const ticketsBefore = structuredClone([...tickets]);
  const remoteBefore = structuredClone(remoteOrders);

  reconcileCompletedSaleRetention({
    retainedCompletedEntries: retainedInput,
    previousLocalEntries: previous,
    queue,
    tickets,
    remoteEntries: visibleRemoteEntries(remoteOrders),
  });

  assert.deepEqual(queue, queueBefore);
  assert.deepEqual(previous, previousBefore);
  assert.deepEqual([...tickets], ticketsBefore);
  assert.deepEqual(remoteOrders, remoteBefore);
  assert.equal(retainedInput.size, 0);
});

test('does not purge for a matching raw remote with invalid id or date', () => {
  const retainedInput = new Map([
    ['sale-a', localEntry('sale-a', { localStatus: 'updating' })],
  ]);
  const invalidRemoteOrders = [
    remoteOrder('sale-a', { id: 0 }),
    remoteOrder('sale-a', { date_order: 'not-a-date' }),
  ];

  assert.deepEqual(visibleRemoteEntries(invalidRemoteOrders), []);
  const retained = reconcileCompletedSaleRetention({
    retainedCompletedEntries: retainedInput,
    previousLocalEntries: [],
    queue: [],
    tickets: new Map(),
    remoteEntries: visibleRemoteEntries(invalidRemoteOrders),
  });

  assert.equal(retained.get('sale-a')?.localStatus, 'updating');
});

test('does not purge for a matching remote outside the requested day', () => {
  const retained = reconcileCompletedSaleRetention({
    retainedCompletedEntries: new Map([
      ['sale-a', localEntry('sale-a', { localStatus: 'updating' })],
    ]),
    previousLocalEntries: [],
    queue: [],
    tickets: new Map(),
    remoteEntries: visibleRemoteEntries([
      remoteOrder('sale-a', {
        date_order: '2026-07-24T10:31:00-06:00',
      }),
    ]),
  });

  assert.equal(retained.has('sale-a'), true);
});

test('ignores malformed raw remote rows before retention without throwing', () => {
  const malformed = [
    null,
    {},
    { id: 12, operation_id: 'sale-a', date_order: null },
  ] as unknown as GFSalesOrder[];
  let projected: SalesListEntry[] = [];

  assert.doesNotThrow(() => {
    projected = visibleRemoteEntries(malformed);
  });
  assert.deepEqual(projected, []);
  assert.doesNotThrow(() => {
    const retained = reconcileCompletedSaleRetention({
      retainedCompletedEntries: new Map([
        ['sale-a', localEntry('sale-a', { localStatus: 'updating' })],
      ]),
      previousLocalEntries: [],
      queue: [],
      tickets: new Map(),
      remoteEntries: projected,
    });
    assert.equal(retained.has('sale-a'), true);
  });
});
