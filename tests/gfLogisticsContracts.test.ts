import assert from 'node:assert/strict';

interface ContractsModule {
  buildSalesCreatePayload: (payload: Record<string, unknown>) => Record<string, unknown>;
  buildPaymentsCreatePayload: (payload: Record<string, unknown>) => Record<string, unknown>;
}

function testSalesPayloadMatchesRealContract(module: ContractsModule) {
  const actual = module.buildSalesCreatePayload({
    _operationId: 'sale-uuid-123',
    partner_id: 52738,
    stop_id: 1042,
    warehouse_id: 8,
    pricelist_id: 81,
    analytic_plaza_id: 820,
    analytic_un_id: 864,
    analytic_distribution: {
      820: 100,
      864: 100,
    },
    payment_method: 'cash',
    lines: [
      { product_id: 987, qty: 2, price_unit: 50, discount: 0 },
    ],
    total: 100,
    total_kg: 20,
    state: 'draft',
    x_stop_id: 999,
  });

  assert.deepEqual(actual, {
    operation_id: 'sale-uuid-123',
    partner_id: 52738,
    stop_id: 1042,
    warehouse_id: 8,
    pricelist_id: 81,
    analytic_plaza_id: 820,
    analytic_un_id: 864,
    analytic_distribution: {
      820: 100,
      864: 100,
    },
    payment_method: 'cash',
    lines: [
      { product_id: 987, quantity: 2, discount: 0 },
    ],
  });
}

function testSalesPayloadLetsBackendComputePricelistPrice(module: ContractsModule) {
  const actual = module.buildSalesCreatePayload({
    _operationId: 'sale-uuid-125',
    partner_id: 55251,
    warehouse_id: 8,
    pricelist_id: 90,
    lines: [
      { product_id: 758, quantity: 1, price_unit: 999, discount: 0 },
    ],
  });

  assert.deepEqual(actual, {
    operation_id: 'sale-uuid-125',
    partner_id: 55251,
    warehouse_id: 8,
    pricelist_id: 90,
    lines: [
      { product_id: 758, quantity: 1, discount: 0 },
    ],
  });
}

function testSalesPayloadCanRequestAccountMoveCreation(module: ContractsModule) {
  const actual = module.buildSalesCreatePayload({
    _operationId: 'sale-uuid-126',
    partner_id: 55251,
    warehouse_id: 8,
    create_invoice: true,
    payment_method: 'cash',
    lines: [
      { product_id: 758, quantity: 1, discount: 0 },
    ],
  });

  assert.deepEqual(actual, {
    operation_id: 'sale-uuid-126',
    partner_id: 55251,
    warehouse_id: 8,
    create_invoice: true,
    payment_method: 'cash',
    lines: [
      { product_id: 758, quantity: 1, discount: 0 },
    ],
  });
}

function testSalesPayloadOmitsVirtualStopAndEmptyOptionals(module: ContractsModule) {
  const actual = module.buildSalesCreatePayload({
    operation_id: 'sale-uuid-124',
    partner_id: 52738,
    stop_id: -44,
    warehouse_id: null,
    lines: [
      { product_id: 987, quantity: 2 },
    ],
  });

  assert.deepEqual(actual, {
    operation_id: 'sale-uuid-124',
    partner_id: 52738,
    lines: [
      { product_id: 987, quantity: 2, discount: 0 },
    ],
  });
}

function testSalesPayloadOmitsNullPricelistWithoutMutatingQueuedPayload(module: ContractsModule) {
  const queuedPayload: Record<string, unknown> = {
    operation_id: 'sale-offline-uuid-1',
    partner_id: 52738,
    warehouse_id: 8,
    pricelist_id: null,
    lines: [
      { product_id: 987, quantity: 2 },
    ],
  };

  const actual = module.buildSalesCreatePayload(queuedPayload);

  assert.equal(queuedPayload.pricelist_id, null);
  assert.equal('pricelist_id' in actual, false);
  assert.deepEqual(actual, {
    operation_id: 'sale-offline-uuid-1',
    partner_id: 52738,
    warehouse_id: 8,
    lines: [
      { product_id: 987, quantity: 2, discount: 0 },
    ],
  });
}

function testSalesPayloadKeepsOffrouteVisitIdForCorte(module: ContractsModule) {
  const actual = module.buildSalesCreatePayload({
    operation_id: 'sale-uuid-127',
    partner_id: 52738,
    stop_id: null,
    offroute_visit_id: 9981,
    warehouse_id: 8,
    lines: [
      { product_id: 987, quantity: 2 },
    ],
  });

  assert.deepEqual(actual, {
    operation_id: 'sale-uuid-127',
    partner_id: 52738,
    offroute_visit_id: 9981,
    warehouse_id: 8,
    lines: [
      { product_id: 987, quantity: 2, discount: 0 },
    ],
  });
}

function testPaymentPayloadMatchesKnownContractFields(module: ContractsModule) {
  const actual = module.buildPaymentsCreatePayload({
    _operationId: 'payment-uuid-123',
    partner_id: 52738,
    stop_id: 1042,
    amount: 100,
    journal_id: 8,
    payment_method_line_id: 3,
    payment_method: 'cash',
    invoice_ids: [77],
    reference: 'Cobro visita',
  });

  assert.deepEqual(actual, {
    operation_id: 'payment-uuid-123',
    partner_id: 52738,
    stop_id: 1042,
    amount: 100,
    journal_id: 8,
    payment_method_line_id: 3,
    reference: 'Cobro visita',
  });
}

function testPaymentPayloadKeepsJournalWhenMethodLineIsUnavailable(module: ContractsModule) {
  const actual = module.buildPaymentsCreatePayload({
    x_operation_id: 'payment-uuid-124',
    partner_id: 52738,
    amount: 100,
    journal_id: 8,
    payment_method: 'transfer',
  });

  assert.deepEqual(actual, {
    operation_id: 'payment-uuid-124',
    partner_id: 52738,
    amount: 100,
    journal_id: 8,
  });
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/gfLogisticsContracts.ts', import.meta.url).pathname
  ) as ContractsModule;

  testSalesPayloadMatchesRealContract(module);
  testSalesPayloadLetsBackendComputePricelistPrice(module);
  testSalesPayloadCanRequestAccountMoveCreation(module);
  testSalesPayloadOmitsVirtualStopAndEmptyOptionals(module);
  testSalesPayloadOmitsNullPricelistWithoutMutatingQueuedPayload(module);
  testSalesPayloadKeepsOffrouteVisitIdForCorte(module);
  testPaymentPayloadMatchesKnownContractFields(module);
  testPaymentPayloadKeepsJournalWhenMethodLineIsUnavailable(module);
  console.log('gf logistics contracts tests: ok');
}

void main();
