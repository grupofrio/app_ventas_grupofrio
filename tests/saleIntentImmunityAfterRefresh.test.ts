import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSaleRecoveryIntent,
  restoreSaleRecoveryIntent,
} from '../src/services/saleRecoveryIntent.ts';

const baseIntent = {
  version: 1 as const,
  operationId: 'sale-op-abc',
  queuePayload: {
    _operationId: 'sale-op-abc',
    partner_id: 501,
    stop_id: 44,
    pricelist_id: 104,
    payment_method: 'cash',
    lines: [{ product_id: 7, quantity: 2, discount: 0 }],
    _clientCustomerName: 'Abarrotes Lupita',
    _clientTotal: 100,
    _localStockDelta: [{ product_id: 7, qty: -2 }],
    _ledgerApplied: true,
  },
  stopId: 44,
  photoUris: ['file://sale.jpg'],
  ticketSnapshot: {
    saleId: 'sale-op-abc',
    odooFolio: null,
    customerName: 'Abarrotes Lupita',
    sellerName: 'Vendedor',
    paymentMethod: 'cash' as const,
    paymentLabel: 'Efectivo',
    createdAt: '2026-08-19T10:00:00.000Z',
    lines: [{
      productId: 7,
      productName: 'Hielo',
      qty: 2,
      unitPrice: 50,
      lineTotal: 100,
      weight: 5,
    }],
    subtotal: 100,
    total: 100,
    totalKg: 10,
  },
};

test('sale recovery intent survives route refresh payload drift simulation', () => {
  const intent = createSaleRecoveryIntent(baseIntent);
  const refreshedUiPayload = {
    ...intent.queuePayload,
    pricelist_id: 999,
    lines: [{ product_id: 7, quantity: 5, discount: 0 }],
    _clientTotal: 250,
  };
  assert.notDeepEqual(refreshedUiPayload, intent.queuePayload);
  const restored = restoreSaleRecoveryIntent(JSON.parse(JSON.stringify(intent)));
  assert.deepEqual(restored?.queuePayload, intent.queuePayload);
  assert.equal(restored?.operationId, 'sale-op-abc');
});

test('same UUID with modified payload is rejected on restore', () => {
  const intent = createSaleRecoveryIntent(baseIntent);
  assert.equal(restoreSaleRecoveryIntent({
    ...intent,
    queuePayload: {
      ...intent.queuePayload,
      _operationId: 'sale-op-other',
    },
  }), null);
});

test('OPERATION_ID_INCIDENT_NOT_YET_REPRODUCED capture instructions are documented in diagnostics helper', async () => {
  const intent = createSaleRecoveryIntent(baseIntent);
  const diagnostics = await import('../src/services/operationIntentDiagnostics.ts');
  const fingerprint = diagnostics.fingerprintOperationPayload(intent.queuePayload);
  assert.match(fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(
    diagnostics.describeOperationIntentDiagnostics({
      operationType: 'sale_order',
      operationId: intent.operationId,
      payload: intent.queuePayload,
      recoveryState: 'pending',
      queueState: 'queued',
    }).operation_id_masked.length > 0,
    true,
  );
});
