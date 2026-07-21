import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSaleRecoveryIntent,
  restoreSaleRecoveryIntent,
  type SaleRecoveryIntentV1,
} from '../src/services/saleRecoveryIntent.ts';

const ticketSnapshot = {
  saleId: 'sale-op-1',
  customerName: 'Abarrotes Lupita',
  sellerName: 'Vendedor',
  paymentMethod: 'cash' as const,
  paymentLabel: 'Efectivo',
  createdAt: '2026-07-21T10:00:00.000Z',
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
};

function validIntent(): SaleRecoveryIntentV1 {
  return {
    version: 1,
    operationId: 'sale-op-1',
    queuePayload: {
      _operationId: 'sale-op-1',
      partner_id: 501,
      _clientCustomerName: 'Abarrotes Lupita',
      _clientTotal: 100,
    },
    stopId: 44,
    photoUris: ['file://sale-1.jpg'],
    ticketSnapshot,
  };
}

test('creates and restores a versioned RN-free sale recovery intent', () => {
  const intent = createSaleRecoveryIntent(validIntent());
  const roundTrip = JSON.parse(JSON.stringify(intent));

  assert.deepEqual(restoreSaleRecoveryIntent(roundTrip), intent);
});

test('rejects intents whose operation id does not match payload and ticket', () => {
  const base = validIntent();

  assert.equal(restoreSaleRecoveryIntent({
    ...base,
    queuePayload: { ...base.queuePayload, _operationId: 'sale-other' },
  }), null);
  assert.equal(restoreSaleRecoveryIntent({
    ...base,
    ticketSnapshot: { ...base.ticketSnapshot, saleId: 'sale-other' },
  }), null);
  assert.equal(restoreSaleRecoveryIntent({ ...base, operationId: '   ' }), null);
  assert.equal(restoreSaleRecoveryIntent({ ...base, version: 2 }), null);
});

test('intent restoration is total for hostile unknown values', () => {
  const hostile = new Proxy({}, {
    get() { throw new Error('get trap'); },
    getPrototypeOf() { throw new Error('prototype trap'); },
  });

  assert.doesNotThrow(() => restoreSaleRecoveryIntent(hostile));
  assert.equal(restoreSaleRecoveryIntent(hostile), null);
});
