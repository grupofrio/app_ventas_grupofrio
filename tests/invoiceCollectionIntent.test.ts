import assert from 'node:assert/strict';
import test from 'node:test';

interface InvoiceCollectionLogic {
  createInvoiceCollectionIntent(input: unknown): unknown;
  parseOpenInvoicesResponse(input: unknown): unknown;
  parseInvoiceCollectionServerResult(input: unknown, operationId: string): unknown;
}

async function loadLogic(): Promise<InvoiceCollectionLogic> {
  return await import('../src/services/invoiceCollection.ts') as InvoiceCollectionLogic;
}

const operationId = '11111111-2222-4aaa-8bbb-333333333333';

test('collection intent keeps exactly the server authority fields plus local snapshot metadata', async () => {
  const logic = await loadLogic();
  const intent = logic.createInvoiceCollectionIntent({
    operation_id: operationId,
    stop_id: 42,
    invoice_id: 99,
    amount: 125.5,
    payment_method: 'cash',
    snapshot_residual: 150,
    snapshot_as_of: '2026-08-17T12:00:00Z',
    now_ms: 1723896000000,
  });

  assert.deepEqual(intent, {
    operation_id: operationId,
    stop_id: 42,
    invoice_id: 99,
    amount: 125.5,
    payment_method: 'cash',
    snapshot_residual: 150,
    snapshot_as_of: '2026-08-17T12:00:00Z',
    status: 'dispatching',
    created_at_ms: 1723896000000,
    updated_at_ms: 1723896000000,
  });
});

test('collection intent rejects non-v4 ids, unknown methods and amounts beyond the selected snapshot', async () => {
  const logic = await loadLogic();
  const base = {
    operation_id: operationId,
    stop_id: 42,
    invoice_id: 99,
    amount: 150,
    payment_method: 'transfer',
    snapshot_residual: 150,
    snapshot_as_of: null,
  };

  assert.throws(() => logic.createInvoiceCollectionIntent({ ...base, operation_id: 'not-a-uuid' }), /UUID v4/i);
  assert.throws(() => logic.createInvoiceCollectionIntent({ ...base, payment_method: 'credit' }), /método/i);
  assert.throws(() => logic.createInvoiceCollectionIntent({ ...base, amount: 150.01 }), /saldo/i);
  assert.throws(() => logic.createInvoiceCollectionIntent({ ...base, company_id: 1 }), /no está permitido/i);
});

test('invoice parsers normalize successful GF envelopes', async () => {
  const logic = await loadLogic();

  assert.deepEqual(logic.parseOpenInvoicesResponse({
    ok: true,
    data: {
      stop_id: 42,
      as_of: '2026-08-18T12:00:00Z',
      invoices: [{
        invoice_id: 99,
        name: 'INV/2026/00099',
        invoice_date: '2026-08-01',
        due_date: null,
        currency: 'MXN',
        amount_residual: 125.5,
      }],
    },
  }), [{
    invoice_id: 99,
    name: 'INV/2026/00099',
    invoice_date: '2026-08-01',
    due_date: null,
    currency: 'MXN',
    amount_residual: 125.5,
  }]);

  assert.deepEqual(logic.parseInvoiceCollectionServerResult({
    ok: true,
    data: { state: 'applied', operation_id: operationId },
  }, operationId), { status: 'applied', operation_id: operationId });
});

test('invoice parsers reject GF error envelopes so review responses remain sync errors', async () => {
  const logic = await loadLogic();
  const reviewResponse = {
    ok: false,
    code: 'review_required',
    data: { state: 'review_required', operation_id: operationId, reason: 'Saldo cambió.' },
  };

  assert.throws(
    () => logic.parseInvoiceCollectionServerResult(reviewResponse, operationId),
    /respuesta de cobranza/i,
  );

  const sync = await import('../src/services/invoiceCollectionSync.ts');
  assert.deepEqual(
    sync.classifyInvoiceCollectionError({ httpStatus: 409, code: 'review_required', responseReceived: true }),
    { kind: 'review_required', code: 'review_required', httpStatus: 409 },
  );
});
