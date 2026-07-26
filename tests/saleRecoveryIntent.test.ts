import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSaleRecoveryIntent,
  restoreSaleRecoveryIntent,
  type SaleRecoveryIntentV1,
} from '../src/services/saleRecoveryIntent.ts';

const ticketSnapshot = {
  saleId: 'sale-op-1',
  odooFolio: null,
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
  assert.equal(intent.ticketSnapshot.odooFolio, null);
});

test('restores the deliberate legacy ticket fixture with a pending Odoo folio', () => {
  const legacyTicketSnapshot = {
    saleId: 'sale-op-1',
    customerName: 'Abarrotes Lupita',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
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

  const restored = restoreSaleRecoveryIntent({
    ...validIntent(),
    ticketSnapshot: legacyTicketSnapshot,
  });

  assert.ok(restored);
  assert.equal(restored.ticketSnapshot.odooFolio, null);
});

test('normalizes a persisted official Odoo folio and rejects invalid folio types', () => {
  const official = restoreSaleRecoveryIntent({
    ...validIntent(),
    ticketSnapshot: {
      ...ticketSnapshot,
      odooFolio: '  S00042  ',
    },
  });

  assert.ok(official);
  assert.equal(official.ticketSnapshot.odooFolio, 'S00042');
  assert.equal(restoreSaleRecoveryIntent({
    ...validIntent(),
    ticketSnapshot: {
      ...ticketSnapshot,
      odooFolio: 42,
    },
  }), null);
});

test('ticket origin and captured price provenance survive recovery JSON rehydration', () => {
  const base = validIntent();
  const withMetadata: SaleRecoveryIntentV1 = {
    ...base,
    ticketSnapshot: {
      ...base.ticketSnapshot,
      origin: 'local',
      lines: [{
        ...base.ticketSnapshot.lines[0],
        priceSource: 'last_known_customer',
        priceCapturedAtMs: 1_753_350_000_000,
        pricelistId: 81,
      }],
    },
  };

  const restored = restoreSaleRecoveryIntent(
    JSON.parse(JSON.stringify(withMetadata)),
  );

  assert.deepEqual(restored, withMetadata);
});

test('legacy recovery tickets without origin or price provenance remain valid', () => {
  const restored = restoreSaleRecoveryIntent(
    JSON.parse(JSON.stringify(validIntent())),
  );

  assert.deepEqual(restored, validIntent());
  assert.equal(restored?.ticketSnapshot.origin, undefined);
  assert.equal(restored?.ticketSnapshot.lines[0].priceSource, undefined);
});

test('rejects invalid present ticket origin and captured price provenance', () => {
  const base = validIntent();
  const invalidSnapshots = [
    { ...base.ticketSnapshot, origin: 'server' },
    {
      ...base.ticketSnapshot,
      lines: [{ ...base.ticketSnapshot.lines[0], priceSource: 'guessed' }],
    },
    {
      ...base.ticketSnapshot,
      lines: [{ ...base.ticketSnapshot.lines[0], priceCapturedAtMs: -1 }],
    },
    {
      ...base.ticketSnapshot,
      lines: [{
        ...base.ticketSnapshot.lines[0],
        priceCapturedAtMs: Number.POSITIVE_INFINITY,
      }],
    },
    {
      ...base.ticketSnapshot,
      lines: [{ ...base.ticketSnapshot.lines[0], pricelistId: 0 }],
    },
    {
      ...base.ticketSnapshot,
      lines: [{ ...base.ticketSnapshot.lines[0], pricelistId: -1 }],
    },
    {
      ...base.ticketSnapshot,
      lines: [{ ...base.ticketSnapshot.lines[0], pricelistId: 1.5 }],
    },
    {
      ...base.ticketSnapshot,
      lines: [{
        ...base.ticketSnapshot.lines[0],
        pricelistId: Number.POSITIVE_INFINITY,
      }],
    },
    { ...base.ticketSnapshot, lines: undefined },
    { ...base.ticketSnapshot, total: undefined },
    { ...base.ticketSnapshot, subtotal: -1 },
    { ...base.ticketSnapshot, total: Number.POSITIVE_INFINITY },
    { ...base.ticketSnapshot, totalKg: -1 },
    {
      ...base.ticketSnapshot,
      lines: [{ ...base.ticketSnapshot.lines[0], productId: 0 }],
    },
    {
      ...base.ticketSnapshot,
      lines: [{ ...base.ticketSnapshot.lines[0], qty: 0 }],
    },
    {
      ...base.ticketSnapshot,
      lines: [{ ...base.ticketSnapshot.lines[0], unitPrice: -1 }],
    },
    {
      ...base.ticketSnapshot,
      lines: [{ ...base.ticketSnapshot.lines[0], lineTotal: Number.NaN }],
    },
    {
      ...base.ticketSnapshot,
      lines: [{ ...base.ticketSnapshot.lines[0], weight: -1 }],
    },
  ];

  for (const snapshot of invalidSnapshots) {
    assert.equal(
      restoreSaleRecoveryIntent({ ...base, ticketSnapshot: snapshot }),
      null,
    );
  }
});

test('accepts null or nonnegative captured timestamps and null or positive pricelists', () => {
  const base = validIntent();

  for (const metadata of [
    {
      priceSource: 'prepared_customer' as const,
      priceCapturedAtMs: null,
      pricelistId: null,
    },
    {
      priceSource: 'public_fallback' as const,
      priceCapturedAtMs: 0,
      pricelistId: 81,
    },
  ]) {
    const candidate: SaleRecoveryIntentV1 = {
      ...base,
      ticketSnapshot: {
        ...base.ticketSnapshot,
        origin: 'local',
        lines: [{ ...base.ticketSnapshot.lines[0], ...metadata }],
      },
    };
    assert.deepEqual(restoreSaleRecoveryIntent(candidate), candidate);
  }
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
