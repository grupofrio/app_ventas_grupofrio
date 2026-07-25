import assert from 'node:assert/strict';
import test from 'node:test';

import { projectLocalSale } from '../src/services/salesListProjection.ts';
import type { SaleTicketSnapshot } from '../src/services/saleTicket.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';

function makeQueueItem(
  overrides: Partial<SyncQueueItem> = {},
): SyncQueueItem {
  return {
    id: 'sale-local-1',
    type: 'sale_order',
    payload: {},
    status: 'pending',
    created_at: 1_721_865_600_000,
    retries: 0,
    error_message: null,
    priority: 1,
    next_retry_at: null,
    ...overrides,
  };
}

function makeTicket(
  overrides: Partial<SaleTicketSnapshot> = {},
): SaleTicketSnapshot {
  return {
    saleId: 'sale-local-1',
    origin: 'local',
    customerName: 'Abarrotes Centro',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    paymentLabel: 'Efectivo',
    createdAt: '2026-07-25T15:30:00.000Z',
    lines: [],
    subtotal: 115,
    total: 115,
    totalKg: 23,
    ...overrides,
  };
}

test('projects a pending sale from its preferred ticket fields', () => {
  const queueItem = makeQueueItem({
    payload: {
      _clientCustomerName: 'Nombre del payload',
      _clientTotal: 99,
      lines: [{ quantity: 1, weight: 2 }],
    },
  });
  const ticket = makeTicket();

  const entry = projectLocalSale(queueItem, ticket);

  assert.ok(entry);
  assert.equal(entry.key, 'local:sale-local-1');
  assert.equal(entry.operationId, 'sale-local-1');
  assert.equal(entry.origin, 'local');
  assert.equal(entry.localStatus, 'pending');
  assert.equal(entry.customerName, 'Abarrotes Centro');
  assert.equal(entry.amountTotal, 115);
  assert.equal(entry.kgTotal, 23);
  assert.equal(entry.createdAtMs, Date.parse('2026-07-25T15:30:00.000Z'));
  assert.equal(entry.errorMessage, null);
});

test('maps syncing sales to syncing', () => {
  const entry = projectLocalSale(
    makeQueueItem({ status: 'syncing' }),
    null,
  );

  assert.equal(entry?.localStatus, 'syncing');
});

test('maps retryable errors to retrying and sanitizes their latest message', () => {
  const entry = projectLocalSale(
    makeQueueItem({
      status: 'error',
      retries: 1,
      next_retry_at: Date.now() + 30_000,
      error_message: ' \n  Sin   conexión\u0000 temporal \t ',
    }),
    null,
  );

  assert.equal(entry?.localStatus, 'retrying');
  assert.equal(entry?.errorMessage, 'Sin conexión temporal');
});

test('maps dead terminal sales to needs_attention and keeps stock rejection context', () => {
  const entry = projectLocalSale(
    makeQueueItem({
      status: 'dead',
      retries: 3,
      error_message: '  Stock insuficiente para Hielo 5 kg.  ',
    }),
    null,
  );

  assert.equal(entry?.localStatus, 'needs_attention');
  assert.equal(entry?.errorMessage, 'Stock insuficiente para Hielo 5 kg.');
});

test('does not project done sales because their card comes from Odoo refresh', () => {
  assert.equal(
    projectLocalSale(makeQueueItem({ status: 'done' }), makeTicket()),
    null,
  );
});

test('excludes queue items that are not sale_order operations', () => {
  assert.equal(
    projectLocalSale(makeQueueItem({ type: 'payment' }), null),
    null,
  );
});

test('falls back field by field to safe payload metadata and line weights', () => {
  const entry = projectLocalSale(
    makeQueueItem({
      payload: {
        _clientCustomerName: '  Tienda La Esquina  ',
        _clientTotal: 88.5,
        lines: [
          { quantity: 2, weight: 5 },
          { qty: 3, weight: 1.5 },
        ],
      },
    }),
    makeTicket({
      customerName: '   ',
      total: Number.NaN,
      totalKg: Number.POSITIVE_INFINITY,
      createdAt: 'not-a-date',
    }),
  );

  assert.ok(entry);
  assert.equal(entry.customerName, 'Tienda La Esquina');
  assert.equal(entry.amountTotal, 88.5);
  assert.equal(entry.kgTotal, 14.5);
  assert.equal(entry.createdAtMs, 1_721_865_600_000);
});

test('supports persisted line-total kilogram fields without multiplying them again', () => {
  const entry = projectLocalSale(
    makeQueueItem({
      payload: {
        lines: [
          { quantity: 2, kg_total: 9 },
          { qty: 3, weight_total: 6 },
        ],
      },
    }),
    null,
  );

  assert.equal(entry?.kgTotal, 15);
});

test('keeps a metadata-free legacy sale visible with unknown optional totals', () => {
  const legacy = projectLocalSale(makeQueueItem(), null);

  assert.ok(legacy);
  assert.equal(legacy.customerName, 'Cliente sin nombre');
  assert.equal(legacy.amountTotal, null);
  assert.equal(legacy.kgTotal, null);
  assert.equal(legacy.createdAtMs, 1_721_865_600_000);
});

test('rejects blank operation identities and trims valid queue identities', () => {
  assert.equal(
    projectLocalSale(makeQueueItem({ id: ' \t ' }), null),
    null,
  );

  const entry = projectLocalSale(
    makeQueueItem({ id: '  sale-local-2  ' }),
    null,
  );
  assert.equal(entry?.operationId, 'sale-local-2');
  assert.equal(entry?.key, 'local:sale-local-2');
});

test('malformed optional fields never throw or produce NaN', () => {
  const queueItem = makeQueueItem({
    payload: {
      _clientCustomerName: { label: 'not a string' },
      _clientTotal: Number.NaN,
      lines: [
        { quantity: '2', weight: 5 },
        null,
        { qty: 1, weight: Number.NaN },
      ],
    },
    created_at: Number.NaN,
    error_message: { message: 'not a string' } as unknown as string,
  });
  const malformedTicket = makeTicket({
    customerName: null as unknown as string,
    total: Number.NaN,
    totalKg: Number.NEGATIVE_INFINITY,
    createdAt: null as unknown as string,
  });

  const entry = projectLocalSale(queueItem, malformedTicket);

  assert.ok(entry);
  assert.equal(entry.customerName, 'Cliente sin nombre');
  assert.equal(entry.amountTotal, null);
  assert.equal(entry.kgTotal, null);
  assert.equal(entry.createdAtMs, 0);
  assert.equal(entry.errorMessage, null);
  assert.equal(Number.isNaN(entry.amountTotal), false);
  assert.equal(Number.isNaN(entry.kgTotal), false);
  assert.equal(Number.isNaN(entry.createdAtMs), false);
});

test('does not mutate queue or ticket inputs', () => {
  const queueItem = makeQueueItem({
    payload: {
      _clientCustomerName: ' Cliente ',
      _clientTotal: 15,
      lines: [{ quantity: 2, weight: 3 }],
    },
    error_message: ' timeout ',
  });
  const ticket = makeTicket();
  const originalQueue = structuredClone(queueItem);
  const originalTicket = structuredClone(ticket);

  projectLocalSale(queueItem, ticket);

  assert.deepEqual(queueItem, originalQueue);
  assert.deepEqual(ticket, originalTicket);
});
