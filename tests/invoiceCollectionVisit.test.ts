import assert from 'node:assert/strict';
import test from 'node:test';

interface InvoiceCollectionVisitLogic {
  buildVisitCollectionState: (bundle: unknown, stopId: number, intents: unknown[]) => {
    stop_id: number;
    customer_name: string | null;
    snapshot_as_of: string | null;
    invoices: readonly {
      invoice: Readonly<{
        invoice_id: number;
        name: string;
        invoice_date: string | null;
        due_date: string | null;
        currency: string;
        amount_residual: number;
      }>;
      collection_state: 'ready' | 'pending' | 'review_required' | 'requires_refresh';
      intent: Readonly<{ operation_id: string; status: string }> | null;
    }[];
  };
  assertVisitCollectionAmount: (invoice: { amount_residual: number }, amount: unknown) => number;
}

async function loadLogic(): Promise<InvoiceCollectionVisitLogic> {
  return await import('../src/services/invoiceCollectionVisit.ts') as InvoiceCollectionVisitLogic;
}

const bundle = {
  schema_version: 'day_bundle.v1',
  operational_date: '2026-08-18',
  expires_at: null,
  plan: { id: 1, date: '2026-08-18', state: 'in_progress', route_id: 2, vehicle_id: 3 },
  stops: [{ id: 71, sequence: 1, state: 'in_progress', kind: 'customer', customer: { id: 501, name: 'Abarrotes del Centro' }, payment_term: null }],
  catalog: [], directory: [], no_sale_reasons: [], gift_reasons: [], competitors: [],
  invoice_snapshots: [{
    stop_id: 71,
    as_of: '2026-08-18 14:00:00',
    invoices: [{
      invoice_id: 19,
      name: 'FAC/2026/0019',
      invoice_date: '2026-08-01',
      due_date: '2026-08-15',
      currency: 'MXN',
      amount_residual: 125.5,
    }],
  }],
};

const intent = {
  operation_id: '11111111-2222-4aaa-8bbb-333333333333',
  stop_id: 71,
  invoice_id: 19,
  amount: 125.5,
  payment_method: 'cash',
  snapshot_residual: 125.5,
  snapshot_as_of: '2026-08-18 14:00:00',
  status: 'dispatching',
  created_at_ms: 1,
  updated_at_ms: 1,
};

test('projects only the selected stop snapshot and preserves invoice display fields', async () => {
  const logic = await loadLogic();

  assert.deepEqual(logic.buildVisitCollectionState(bundle, 71, []), {
    stop_id: 71,
    customer_name: 'Abarrotes del Centro',
    snapshot_as_of: '2026-08-18 14:00:00',
    invoices: [{
      invoice: bundle.invoice_snapshots[0].invoices[0],
      collection_state: 'ready',
      intent: null,
    }],
  });
});

test('requires a real bundle stop and exactly one matching invoice snapshot', async () => {
  const logic = await loadLogic();

  assert.throws(() => logic.buildVisitCollectionState({ ...bundle, stops: [] }, 71, []), /stop/i);
  assert.throws(() => logic.buildVisitCollectionState({ ...bundle, invoice_snapshots: [] }, 71, []), /snapshot/i);
  assert.throws(
    () => logic.buildVisitCollectionState({ ...bundle, invoice_snapshots: [...bundle.invoice_snapshots, bundle.invoice_snapshots[0]] }, 71, []),
    /snapshot/i,
  );
});

test('rejects a duplicate invoice id inside the selected snapshot', async () => {
  const logic = await loadLogic();
  const selected = bundle.invoice_snapshots[0];

  assert.throws(
    () => logic.buildVisitCollectionState({
      ...bundle,
      invoice_snapshots: [{ ...selected, invoices: [...selected.invoices, selected.invoices[0]] }],
    }, 71, []),
    /invoice_id.*duplicado/i,
  );
});

test('projects pending, review, and same-snapshot applied intents as immutable blockers', async () => {
  const logic = await loadLogic();

  for (const status of ['dispatching', 'pending'] as const) {
    const state = logic.buildVisitCollectionState(bundle, 71, [{ ...intent, status }]);
    assert.equal(state.invoices[0].collection_state, 'pending');
    assert.deepEqual(state.invoices[0].intent, { operation_id: intent.operation_id, status });
  }

  const review = logic.buildVisitCollectionState(bundle, 71, [{ ...intent, status: 'review_required' }]);
  assert.equal(review.invoices[0].collection_state, 'review_required');
  assert.deepEqual(review.invoices[0].intent, { operation_id: intent.operation_id, status: 'review_required' });

  const applied = logic.buildVisitCollectionState(bundle, 71, [{ ...intent, status: 'applied' }]);
  assert.equal(applied.invoices[0].collection_state, 'requires_refresh');
  assert.deepEqual(applied.invoices[0].intent, { operation_id: intent.operation_id, status: 'applied' });
});

test('an applied intent permits a new selection only when the authoritative invoice snapshot changes', async () => {
  const logic = await loadLogic();
  const applied = { ...intent, status: 'applied' as const };

  const remounted = logic.buildVisitCollectionState(bundle, 71, [applied]);
  assert.equal(remounted.invoices[0].collection_state, 'requires_refresh');

  const freshBundle = {
    ...bundle,
    invoice_snapshots: [{
      ...bundle.invoice_snapshots[0],
      as_of: '2026-08-18 14:05:00',
    }],
  };
  const refreshed = logic.buildVisitCollectionState(freshBundle, 71, [applied]);
  assert.equal(refreshed.invoices[0].collection_state, 'ready');
  assert.equal(refreshed.invoices[0].intent, null);
});

test('an applied intent with no snapshot timestamp remains locked until a timestamped snapshot replaces it', async () => {
  const logic = await loadLogic();
  const noTimestampBundle = {
    ...bundle,
    invoice_snapshots: [{ ...bundle.invoice_snapshots[0], as_of: null }],
  };
  const applied = { ...intent, snapshot_as_of: null, status: 'applied' as const };

  assert.equal(
    logic.buildVisitCollectionState(noTimestampBundle, 71, [applied]).invoices[0].collection_state,
    'requires_refresh',
  );
  assert.equal(
    logic.buildVisitCollectionState({
      ...noTimestampBundle,
      invoice_snapshots: [{ ...noTimestampBundle.invoice_snapshots[0], as_of: '2026-08-18 14:10:00' }],
    }, 71, [applied]).invoices[0].collection_state,
    'ready',
  );
});

test('validates collection amounts against the selected snapshot residual', async () => {
  const logic = await loadLogic();
  const invoice = logic.buildVisitCollectionState(bundle, 71, []).invoices[0].invoice;

  assert.equal(logic.assertVisitCollectionAmount(invoice, 125.5), 125.5);
  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 125.51, '125.5']) {
    assert.throws(() => logic.assertVisitCollectionAmount(invoice, amount), /monto|saldo/i);
  }
});

test('rejects non-finite residual bounds from an invalid invoice projection', async () => {
  const logic = await loadLogic();

  for (const amount_residual of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => logic.assertVisitCollectionAmount({ amount_residual }, 1),
      /saldo/i,
    );
  }
});
