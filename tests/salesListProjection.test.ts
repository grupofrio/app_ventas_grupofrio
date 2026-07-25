import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeSalesListEntries,
  normalizeOperationIdForComparison,
  projectLocalSale,
  summarizeLocalSales,
} from '../src/services/salesListProjection.ts';
import type {
  SalesListEntry,
} from '../src/services/salesListProjection.ts';
import type { GFSalesOrder } from '../src/services/gfLogistics.ts';
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

function remoteWithOperation(
  operationId: string,
  overrides: Partial<GFSalesOrder> = {},
): GFSalesOrder {
  return {
    id: 101,
    name: 'SO101',
    partner_id: 17,
    partner_name: 'Cliente Odoo',
    amount_total: 125.5,
    amount_untaxed: 108.19,
    amount_tax: 17.31,
    kg_total: 25,
    state: 'sale',
    date_order: '2026-07-24T16:30:00.000-06:00',
    confirmation_date: '2026-07-24T16:31:00.000-06:00',
    stop_id: 3,
    operation_id: operationId,
    payment_method: 'cash',
    payment_method_label: 'Efectivo',
    employee_name: 'Vendedor',
    lines: [],
    ...overrides,
  };
}

function localWithOperation(
  operationId: string,
  overrides: Partial<SalesListEntry> = {},
): SalesListEntry {
  const normalizedOperationId = operationId.trim();
  return {
    key: `local:${normalizedOperationId}`,
    operationId: normalizedOperationId,
    origin: 'local',
    customerName: 'Cliente local',
    amountTotal: 95,
    kgTotal: 19,
    createdAtMs: new Date(2026, 6, 24, 12, 0, 0).getTime(),
    localStatus: 'pending',
    errorMessage: null,
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

test('ignores every field from a ticket that belongs to another sale', () => {
  const queueItem = makeQueueItem({
    payload: {
      _clientCustomerName: 'Cliente correcto',
      _clientTotal: 72,
      lines: [{ quantity: 2, weight: 3 }],
    },
  });
  const mismatchedTicket = makeTicket({
    saleId: 'another-sale',
    customerName: 'Cliente de otra venta',
    total: 999,
    totalKg: 88,
    createdAt: '2026-07-26T18:00:00.000Z',
  });

  const entry = projectLocalSale(queueItem, mismatchedTicket);

  assert.ok(entry);
  assert.equal(entry.customerName, 'Cliente correcto');
  assert.equal(entry.amountTotal, 72);
  assert.equal(entry.kgTotal, 6);
  assert.equal(entry.createdAtMs, queueItem.created_at);
});

test('accepts a matching ticket identity after trimming both operation IDs', () => {
  const entry = projectLocalSale(
    makeQueueItem({ id: '  sale-local-1  ' }),
    makeTicket({ saleId: '\t sale-local-1 \n' }),
  );

  assert.ok(entry);
  assert.equal(entry.operationId, 'sale-local-1');
  assert.equal(entry.customerName, 'Abarrotes Centro');
  assert.equal(entry.amountTotal, 115);
  assert.equal(entry.kgTotal, 23);
  assert.equal(entry.createdAtMs, Date.parse('2026-07-25T15:30:00.000Z'));
});

test('accepts ticket datetimes with an explicit numeric timezone offset', () => {
  const createdAt = '2026-07-24T23:45:00.250-06:00';
  const entry = projectLocalSale(
    makeQueueItem(),
    makeTicket({ createdAt }),
  );

  assert.equal(entry?.createdAtMs, Date.parse(createdAt));
});

test('rejects timezone-less, date-only, and impossible ticket dates', () => {
  const queueCreatedAt = Date.parse('2026-07-25T06:15:00.000Z');
  const unsafeTicketDates = [
    // In Mexico this looks like the previous local day and Date.parse applies
    // the device timezone, making ordering depend on runtime configuration.
    '2026-07-24T23:45:00',
    '2026-07-24',
    '2026-02-30T10:00:00Z',
  ];

  for (const createdAt of unsafeTicketDates) {
    const entry = projectLocalSale(
      makeQueueItem({ created_at: queueCreatedAt }),
      makeTicket({ createdAt }),
    );
    assert.equal(entry?.createdAtMs, queueCreatedAt, createdAt);
  }
});

test('ignores tickets with blank or invalid runtime identities', () => {
  const queueItem = makeQueueItem({
    payload: {
      _clientCustomerName: 'Fallback seguro',
      _clientTotal: 31,
      lines: [{ qty: 2, weight: 4 }],
    },
  });
  const invalidTickets = [
    makeTicket({ saleId: '   ' }),
    makeTicket({ saleId: null as unknown as string }),
  ];

  for (const ticket of invalidTickets) {
    const entry = projectLocalSale(queueItem, ticket);
    assert.ok(entry);
    assert.equal(entry.customerName, 'Fallback seguro');
    assert.equal(entry.amountTotal, 31);
    assert.equal(entry.kgTotal, 8);
    assert.equal(entry.createdAtMs, queueItem.created_at);
  }
});

test('maps syncing sales to syncing', () => {
  const entry = projectLocalSale(
    makeQueueItem({ status: 'syncing' }),
    null,
  );

  assert.equal(entry?.localStatus, 'syncing');
});

test('maps retryable network errors to safe actionable copy without mutating diagnostics', () => {
  const rawMessage =
    'Network Error POST https://odoo.example/api Authorization: Bearer secret-token';
  const queueItem = makeQueueItem({
    status: 'error',
    retries: 1,
    next_retry_at: Date.now() + 30_000,
    error_message: rawMessage,
  });
  const entry = projectLocalSale(
    queueItem,
    null,
  );

  assert.equal(entry?.localStatus, 'retrying');
  assert.equal(
    entry?.errorMessage,
    'No se pudo enviar la venta por un problema de conexión. Revisa el estado en Sincronización.',
  );
  assert.equal(queueItem.error_message, rawMessage);
});

test('maps dead stock rejection to safe business copy', () => {
  const entry = projectLocalSale(
    makeQueueItem({
      status: 'dead',
      retries: 3,
      error_message:
        'insufficient_stock for Hielo 5 kg at https://odoo.example Authorization: Bearer secret',
    }),
    null,
  );

  assert.equal(entry?.localStatus, 'needs_attention');
  assert.equal(
    entry?.errorMessage,
    'Odoo rechazó la venta por stock insuficiente. Revisa las existencias en Sincronización.',
  );
});

test('redacts unknown technical errors behind stable generic copy', () => {
  const rawMessage = [
    'Request failed POST https://odoo.example/gf/logistics/api/employee/sales/create',
    'Authorization: Bearer ey-secret',
    'X-API-Key=api-secret password=hunter2',
    'Error: internal detail',
    '    at postRest (/app/src/services/api.ts:443:17)',
  ].join('\n');

  const mapped = projectLocalSale(
    makeQueueItem({ status: 'dead', error_message: rawMessage }),
    null,
  )?.errorMessage;

  assert.equal(
    mapped,
    'No se pudo sincronizar la venta. Revisa la operación en Sincronización.',
  );
  assert.doesNotMatch(
    mapped ?? '',
    /https?:|authorization|bearer|api[-_ ]?key|password|postrest|\.ts:\d+/i,
  );
});

test('bounds display errors deterministically and handles blank runtime values', () => {
  const hugeUnknown = `Fallo opaco ${'x'.repeat(10_000)}`;
  const mappedHuge = projectLocalSale(
    makeQueueItem({ status: 'error', error_message: hugeUnknown }),
    null,
  )?.errorMessage;
  const mappedBlank = projectLocalSale(
    makeQueueItem({ status: 'error', error_message: ' \n\t ' }),
    null,
  )?.errorMessage;
  const mappedInvalid = projectLocalSale(
    makeQueueItem({
      status: 'error',
      error_message: { password: 'secret' } as unknown as string,
    }),
    null,
  )?.errorMessage;

  assert.ok(mappedHuge && mappedHuge.length <= 200);
  assert.equal(
    mappedHuge,
    'No se pudo sincronizar la venta. Revisa la operación en Sincronización.',
  );
  assert.equal(mappedBlank, mappedHuge);
  assert.equal(mappedInvalid, mappedHuge);
});

test('does not project done sales because their card comes from Odoo refresh', () => {
  assert.equal(
    projectLocalSale(makeQueueItem({ status: 'done' }), makeTicket()),
    null,
  );
});

test('excludes unknown runtime queue statuses', () => {
  const corruptStatuses = ['deferred', 'updating', ''];

  for (const status of corruptStatuses) {
    const corruptItem = makeQueueItem({
      status: status as SyncQueueItem['status'],
    });
    assert.equal(projectLocalSale(corruptItem, null), null, status);
  }
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

test('normalizes operation IDs with trim and case folding only', () => {
  assert.equal(
    normalizeOperationIdForComparison('  AbC-_  '),
    'abc-_',
  );
  assert.equal(
    normalizeOperationIdForComparison('A  B'),
    'a  b',
  );
});

test('prefers the remote Odoo sale for the same normalized operation ID', () => {
  const merged = mergeSalesListEntries({
    remoteOrders: [remoteWithOperation('ABC')],
    localEntries: [localWithOperation('abc')],
    localDay: '2026-07-24',
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].origin, 'odoo');
  assert.equal(merged[0].operationId, 'ABC');
});

test('keeps the exact remote operation ID while using its normalized value only for comparison', () => {
  const merged = mergeSalesListEntries({
    remoteOrders: [remoteWithOperation('  Sale-AbC  ')],
    localEntries: [localWithOperation('sale-abc')],
    localDay: '2026-07-24',
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.origin, 'odoo');
  assert.equal(merged[0]?.operationId, '  Sale-AbC  ');
});

test('keeps multiple blank remote operation IDs distinct by Odoo order identity', () => {
  const merged = mergeSalesListEntries({
    remoteOrders: [
      remoteWithOperation('   ', { id: 101 }),
      remoteWithOperation('', { id: 102 }),
    ],
    localEntries: [],
    localDay: '2026-07-24',
  });

  assert.deepEqual(
    merged.map((entry) => entry.key),
    ['odoo:101', 'odoo:102'],
  );
  assert.deepEqual(
    merged.map((entry) => entry.operationId),
    ['   ', ''],
  );
});

test('does not reconcile a blank remote operation ID with a local sale', () => {
  const merged = mergeSalesListEntries({
    remoteOrders: [remoteWithOperation('')],
    localEntries: [localWithOperation('abc')],
    localDay: '2026-07-24',
  });

  assert.equal(merged.length, 2);
  assert.deepEqual(
    new Set(merged.map((entry) => entry.origin)),
    new Set(['odoo', 'local']),
  );
});

test('deduplicates repeated remote responses with the same real order ID', () => {
  const order = remoteWithOperation('remote-101');
  const merged = mergeSalesListEntries({
    remoteOrders: [order, { ...order }],
    localEntries: [],
    localDay: '2026-07-24',
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].key, 'odoo:101');
});

test('deduplicates equivalent nonblank remote operation IDs deterministically', () => {
  const lowerKeyOrder = remoteWithOperation('ABC', {
    id: 101,
    date_order: '2026-07-24T12:00:00.000-06:00',
  });
  const higherKeyOrder = remoteWithOperation('  abc  ', {
    id: 202,
    date_order: '2026-07-24T12:00:00.000-06:00',
  });

  for (const remoteOrders of [
    [higherKeyOrder, lowerKeyOrder],
    [lowerKeyOrder, higherKeyOrder],
  ]) {
    const merged = mergeSalesListEntries({
      remoteOrders,
      localEntries: [localWithOperation('AbC')],
      localDay: '2026-07-24',
    });

    assert.equal(merged.length, 1);
    assert.equal(merged[0].origin, 'odoo');
    assert.equal(merged[0].key, 'odoo:101');
    assert.equal(merged[0].operationId, 'ABC');
  }
});

test('uses collision-safe origin-prefixed keys', () => {
  const merged = mergeSalesListEntries({
    remoteOrders: [remoteWithOperation('', { id: 101 })],
    localEntries: [localWithOperation('odoo:101')],
    localDay: '2026-07-24',
  });

  assert.deepEqual(
    merged.map((entry) => entry.key).sort(),
    ['local:odoo:101', 'odoo:101'],
  );
});

test('sorts newest first with a deterministic key tie-break', () => {
  const tiedDate = '2026-07-24T12:00:00.000-06:00';
  const merged = mergeSalesListEntries({
    remoteOrders: [
      remoteWithOperation('two', { id: 2, date_order: tiedDate }),
      remoteWithOperation('one', { id: 1, date_order: tiedDate }),
    ],
    localEntries: [
      localWithOperation('newer', {
        createdAtMs: Date.parse('2026-07-24T13:00:00.000-06:00'),
      }),
    ],
    localDay: '2026-07-24',
  });

  assert.deepEqual(
    merged.map((entry) => entry.key),
    ['local:newer', 'odoo:1', 'odoo:2'],
  );
});

test('filters remote and local entries by the exact local calendar day', () => {
  const lateLocalTime = new Date(2026, 6, 24, 23, 30, 0);
  assert.equal(lateLocalTime.toISOString().slice(0, 10), '2026-07-25');

  const merged = mergeSalesListEntries({
    remoteOrders: [
      remoteWithOperation('remote-boundary', {
        id: 201,
        date_order: lateLocalTime.toISOString(),
      }),
      remoteWithOperation('remote-local-format', {
        id: 202,
        date_order: '2026-07-24 08:15:00',
      }),
      remoteWithOperation('remote-next-day', {
        id: 203,
        date_order: new Date(2026, 6, 25, 0, 15, 0).toISOString(),
      }),
    ],
    localEntries: [
      localWithOperation('local-boundary', {
        createdAtMs: lateLocalTime.getTime(),
      }),
      localWithOperation('local-next-day', {
        createdAtMs: new Date(2026, 6, 25, 0, 15, 0).getTime(),
      }),
    ],
    localDay: '2026-07-24',
  });

  assert.deepEqual(
    new Set(merged.map((entry) => entry.operationId)),
    new Set(['remote-boundary', 'remote-local-format', 'local-boundary']),
  );
});

test('returns an empty result for invalid local day input', () => {
  const invalidDays = [
    '2026-02-30',
    '2026-7-24',
    '2026-07-24T00:00:00',
    '',
  ];

  for (const localDay of invalidDays) {
    const merged = mergeSalesListEntries({
      remoteOrders: [remoteWithOperation('remote')],
      localEntries: [localWithOperation('local')],
      localDay,
    });
    assert.deepEqual(merged, [], localDay);
  }
});

test('projects remote authoritative fields defensively without NaN', () => {
  const malformed = remoteWithOperation('remote-malformed', {
    partner_name: { label: 'not a string' } as unknown as string,
    amount_total: Number.NaN,
    kg_total: Number.NEGATIVE_INFINITY,
  });

  const merged = mergeSalesListEntries({
    remoteOrders: [malformed],
    localEntries: [],
    localDay: '2026-07-24',
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].customerName, 'Cliente sin nombre');
  assert.equal(merged[0].amountTotal, null);
  assert.equal(merged[0].kgTotal, null);
  assert.equal(Number.isNaN(merged[0].createdAtMs), false);
  assert.equal(merged[0].remoteOrder, malformed);
});

test('skips malformed remote rows without throwing', () => {
  const malformedRows = [
    null,
    undefined,
    'not an order',
    42,
    [],
    {},
  ] as unknown as GFSalesOrder[];

  const merged = mergeSalesListEntries({
    remoteOrders: [
      ...malformedRows,
      remoteWithOperation('valid-order', { id: 601 }),
    ],
    localEntries: [],
    localDay: '2026-07-24',
  });

  assert.deepEqual(
    merged.map((entry) => entry.key),
    ['odoo:601'],
  );
});

test('excludes remote orders with invalid dates rather than leaking them across days', () => {
  const merged = mergeSalesListEntries({
    remoteOrders: [
      remoteWithOperation('invalid-date', { date_order: 'not-a-date' }),
    ],
    localEntries: [],
    localDay: '2026-07-24',
  });

  assert.deepEqual(merged, []);
});

test('does not mutate remote orders or local entries while merging', () => {
  const remoteOrders = [remoteWithOperation(' Remote ')];
  const localEntries = [localWithOperation(' Local ')];
  const originalRemoteOrders = structuredClone(remoteOrders);
  const originalLocalEntries = structuredClone(localEntries);

  mergeSalesListEntries({
    remoteOrders,
    localEntries,
    localDay: '2026-07-24',
  });

  assert.deepEqual(remoteOrders, originalRemoteOrders);
  assert.deepEqual(localEntries, originalLocalEntries);
});

test('summarizes pending local cash while treating needs-attention amounts as unknown', () => {
  const entries = [
    localWithOperation('pending', {
      amountTotal: 100,
      localStatus: 'pending',
    }),
    localWithOperation('syncing', {
      amountTotal: 50,
      localStatus: 'syncing',
    }),
    localWithOperation('attention', {
      amountTotal: 999,
      localStatus: 'needs_attention',
    }),
  ];

  assert.deepEqual(summarizeLocalSales(entries), {
    count: 3,
    knownAmountTotal: 150,
    unknownAmountCount: 1,
    needsAttentionCount: 1,
  });
});

test('includes every active local status and sums currency in rounded cents', () => {
  const entries = [
    localWithOperation('pending', {
      amountTotal: 0.1,
      localStatus: 'pending',
    }),
    localWithOperation('syncing', {
      amountTotal: 0.2,
      localStatus: 'syncing',
    }),
    localWithOperation('retrying', {
      amountTotal: 10.005,
      localStatus: 'retrying',
    }),
    localWithOperation('updating', {
      amountTotal: 0,
      localStatus: 'updating',
    }),
  ];

  assert.deepEqual(summarizeLocalSales(entries), {
    count: 4,
    knownAmountTotal: 10.31,
    unknownAmountCount: 0,
    needsAttentionCount: 0,
  });
});

test('counts null, nonfinite, and negative local amounts as unknown', () => {
  const entries = [
    localWithOperation('null', { amountTotal: null }),
    localWithOperation('nan', { amountTotal: Number.NaN }),
    localWithOperation('negative', { amountTotal: -1 }),
  ];

  assert.deepEqual(summarizeLocalSales(entries), {
    count: 3,
    knownAmountTotal: 0,
    unknownAmountCount: 3,
    needsAttentionCount: 0,
  });
});

test('never includes remote Odoo entries in the local pending summary', () => {
  const remoteEntry: SalesListEntry = {
    ...localWithOperation('remote', { amountTotal: 500 }),
    key: 'odoo:501',
    origin: 'odoo',
    localStatus: undefined,
    remoteOrder: remoteWithOperation('remote', { id: 501 }),
  };

  assert.deepEqual(
    summarizeLocalSales([
      remoteEntry,
      localWithOperation('local', { amountTotal: 25 }),
    ]),
    {
      count: 1,
      knownAmountTotal: 25,
      unknownAmountCount: 0,
      needsAttentionCount: 0,
    },
  );
});
