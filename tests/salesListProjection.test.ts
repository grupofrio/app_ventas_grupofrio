import assert from 'node:assert/strict';

async function main() {
  // @ts-ignore -- Node 24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime.
    new URL('../src/services/salesListProjection.ts', import.meta.url).pathname
  );

  const {
    projectLocalSale,
    projectRemoteSale,
    mergeSalesListEntries,
    summarizeLocalSales,
    normalizeOperationIdForComparison,
    localDayOf,
    LEGACY_CUSTOMER_NAME,
  } = module;

  const baseItem = {
    id: 'op-1',
    type: 'sale_order',
    status: 'pending',
    payload: { _clientCustomerName: 'Abarrotes Centro', _clientTotal: 115 },
    created_at: Date.parse('2026-07-24T15:00:00'),
    error_message: null,
  };

  const ticket = {
    saleId: 'op-1',
    odooFolio: null,
    customerName: 'Abarrotes Centro (ticket)',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    paymentLabel: 'Contado',
    createdAt: '2026-07-24T15:00:00',
    lines: [],
    subtotal: 100,
    total: 115,
    totalKg: 12,
  };

  // ── Adaptación local: estados de cola ──────────────────────────────────────
  const pending = projectLocalSale(baseItem, null);
  assert.equal(pending.origin, 'local');
  assert.equal(pending.localStatus, 'pending');
  assert.equal(pending.customerName, 'Abarrotes Centro');
  assert.equal(pending.amountTotal, 115);
  assert.equal(pending.key, 'local:op-1');
  assert.equal(pending.operationId, 'op-1');

  assert.equal(projectLocalSale({ ...baseItem, status: 'syncing' }, null).localStatus, 'syncing');
  assert.equal(projectLocalSale({ ...baseItem, status: 'error' }, null).localStatus, 'retrying');
  assert.equal(projectLocalSale({ ...baseItem, status: 'dead' }, null).localStatus, 'needs_attention');
  assert.equal(projectLocalSale({ ...baseItem, status: 'done' }, null).localStatus, 'updating');

  // Exclusión de tipos distintos a sale_order.
  assert.equal(projectLocalSale({ ...baseItem, type: 'photo' }, null), null);
  assert.equal(projectLocalSale({ ...baseItem, type: 'gps' }, null), null);

  // Ticket preferido sobre payload.
  const withTicket = projectLocalSale(baseItem, ticket);
  assert.equal(withTicket.customerName, 'Abarrotes Centro (ticket)');
  assert.equal(withTicket.amountTotal, 115);
  assert.equal(withTicket.kgTotal, 12);

  // Venta legacy sin ticket ni metadatos: tarjeta visible, monto desconocido.
  const legacy = projectLocalSale({ ...baseItem, payload: {} }, null);
  assert.equal(legacy.customerName, LEGACY_CUSTOMER_NAME);
  assert.equal(legacy.amountTotal, null);
  assert.equal(legacy.kgTotal, null);

  // Mensaje de error solo en retrying / needs_attention.
  const retrying = projectLocalSale(
    { ...baseItem, status: 'error', error_message: 'timeout' },
    null,
  );
  assert.equal(retrying.errorMessage, 'timeout');
  const pendingNoError = projectLocalSale(
    { ...baseItem, error_message: 'stale' },
    null,
  );
  assert.equal(pendingNoError.errorMessage, null);

  // ── Normalización de operation_id ─────────────────────────────────────────
  assert.equal(normalizeOperationIdForComparison('  ABC-1  '), 'abc-1');

  // ── Conciliación local + remoto ───────────────────────────────────────────
  const remoteOrder = (overrides = {}) => ({
    id: 900,
    name: 'S00900',
    partner_id: 5,
    partner_name: 'Abarrotes Centro',
    amount_total: 115,
    amount_untaxed: 100,
    amount_tax: 15,
    kg_total: 12,
    state: 'sale',
    date_order: '2026-07-24 20:30:00',
    confirmation_date: '2026-07-24 20:30:00',
    stop_id: 1,
    operation_id: 'ABC',
    payment_method: 'cash',
    payment_method_label: 'Contado',
    employee_name: 'Vendedor',
    lines: [],
    ...overrides,
  });

  const localDay = localDayOf(baseItem.created_at);

  // El pedido remoto gana (comparación case/trim-insensitive).
  const merged = mergeSalesListEntries({
    remoteOrders: [remoteOrder({ operation_id: 'ABC' })],
    localEntries: [projectLocalSale({ ...baseItem, id: 'abc' }, null)],
    localDay,
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].origin, 'odoo');

  // Varios remotos con operation_id vacío conservan claves odoo:<id> distintas
  // y nunca concilian con locales.
  const blankRemotes = mergeSalesListEntries({
    remoteOrders: [
      remoteOrder({ id: 901, operation_id: '' }),
      remoteOrder({ id: 902, operation_id: '   ' }),
    ],
    localEntries: [projectLocalSale(baseItem, null)],
    localDay,
  });
  assert.equal(blankRemotes.length, 3);
  const keys = blankRemotes.map((e: { key: string }) => e.key).sort();
  assert.deepEqual(keys, ['local:op-1', 'odoo:901', 'odoo:902']);

  // Orden por fecha descendente.
  const ordered = mergeSalesListEntries({
    remoteOrders: [remoteOrder({ id: 903, operation_id: 'zzz', date_order: '2026-07-24 10:00:00' })],
    localEntries: [projectLocalSale(baseItem, null)],
    localDay,
  });
  assert.ok(ordered[0].createdAtMs >= ordered[1].createdAtMs);

  // Filtro de día local: una tarjeta local de otro día no aparece.
  const otherDay = mergeSalesListEntries({
    remoteOrders: [],
    localEntries: [projectLocalSale(
      { ...baseItem, created_at: Date.parse('2026-07-20T10:00:00') },
      null,
    )],
    localDay,
  });
  assert.equal(otherDay.length, 0);

  // ── Resumen de pendientes ─────────────────────────────────────────────────
  const summaryEntries = [
    projectLocalSale({ ...baseItem, id: 'a' }, null),                                   // pending, 115
    projectLocalSale({ ...baseItem, id: 'b', status: 'syncing', payload: { _clientTotal: 35 } }, null), // 35
    projectLocalSale({ ...baseItem, id: 'c', status: 'error', payload: {} }, null),     // monto desconocido
    projectLocalSale({ ...baseItem, id: 'd', status: 'dead' }, null),                   // atención, no suma
    projectLocalSale({ ...baseItem, id: 'e', status: 'done' }, null),                   // updating, no cuenta
    projectRemoteSale(remoteOrder()),                                                   // remoto, no cuenta
  ];
  assert.deepEqual(summarizeLocalSales(summaryEntries), {
    count: 3,
    knownAmountTotal: 150,
    unknownAmountCount: 1,
    needsAttentionCount: 1,
  });

  console.log('sales list projection tests: ok');
}

void main();
