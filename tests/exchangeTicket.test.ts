import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExchangeTicketHtml,
  buildExchangeTicketSnapshot,
  getExchangeTicketStorageKey,
} from '../src/services/exchangeTicket.ts';
import { formatTicketDate } from '../src/services/saleTicketFormatting.ts';

test('buildExchangeTicketSnapshot preserves the idempotency snapshot and visible folio rules', () => {
  const snapshot = buildExchangeTicketSnapshot({
    snapshotId: 'idempotency-123',
    exchangeName: '',
    exchangeId: null,
    customerName: 'Abarrotes La Esperanza',
    createdAt: '2026-07-27T20:35:00.000Z',
    deliveryLines: [
      { productId: 10, productName: 'Coca Cola 600 ml', qty: 2 },
    ],
    mermaLines: [
      { productId: 11, productName: 'Agua 1 L', qty: 1 },
    ],
    notes: 'Envases dañados',
  });

  assert.equal(snapshot.snapshotId, 'idempotency-123');
  assert.equal(snapshot.folio, 'CAMBIO-idempote');
  assert.equal(snapshot.customerName, 'Abarrotes La Esperanza');
  assert.equal(snapshot.createdAt, '2026-07-27T20:35:00.000Z');
  assert.equal(snapshot.deliveryLines[0].qty, 2);
  assert.equal(snapshot.mermaLines[0].qty, 1);
  assert.equal(snapshot.notes, 'Envases dañados');
});

test('buildExchangeTicketSnapshot prefers exchangeName, then exchangeId, then the snapshot fallback folio', () => {
  const preferredName = buildExchangeTicketSnapshot({
    snapshotId: 'idempotency-123',
    exchangeName: 'CAMBIO-ABC',
    exchangeId: 321,
    customerName: 'Cliente',
    createdAt: '2026-07-27T20:35:00.000Z',
    deliveryLines: [],
    mermaLines: [],
  });

  const preferredId = buildExchangeTicketSnapshot({
    snapshotId: 'idempotency-123',
    exchangeName: '   ',
    exchangeId: 321,
    customerName: 'Cliente',
    createdAt: '2026-07-27T20:35:00.000Z',
    deliveryLines: [],
    mermaLines: [],
  });

  const fallback = buildExchangeTicketSnapshot({
    snapshotId: 'idempotency-123',
    exchangeName: '   ',
    exchangeId: null,
    customerName: 'Cliente',
    createdAt: '2026-07-27T20:35:00.000Z',
    deliveryLines: [],
    mermaLines: [],
  });

  assert.equal(preferredName.folio, 'CAMBIO-ABC');
  assert.equal(preferredId.folio, '321');
  assert.equal(fallback.folio, 'CAMBIO-idempote');
});

test('buildExchangeTicketSnapshot applies customer and product fallbacks and keeps empty sections empty', () => {
  const snapshot = buildExchangeTicketSnapshot({
    snapshotId: 'idempotency-123',
    exchangeName: '',
    exchangeId: null,
    customerName: '',
    createdAt: '2026-07-27T20:35:00.000Z',
    deliveryLines: [
      { productId: 10, qty: 2 },
    ],
    mermaLines: [
      { productId: 11, qty: 1.5 },
    ],
    notes: '',
  });

  assert.equal(snapshot.customerName, 'Cliente sin nombre');
  assert.equal(snapshot.deliveryLines[0].productName, 'Producto 10');
  assert.equal(snapshot.mermaLines[0].productName, 'Producto 11');
  assert.equal(snapshot.mermaLines[0].qty, 1.5);
  assert.equal(snapshot.notes, '');

  const emptySnapshot = buildExchangeTicketSnapshot({
    snapshotId: 'idempotency-123',
    exchangeName: '',
    exchangeId: null,
    customerName: '',
    createdAt: '2026-07-27T20:35:00.000Z',
    deliveryLines: [],
    mermaLines: [],
  });

  assert.equal(emptySnapshot.deliveryLines.length, 0);
  assert.equal(emptySnapshot.mermaLines.length, 0);
});

test('buildExchangeTicketHtml escapes customer, product, and notes content and formats the date', () => {
  const snapshot = buildExchangeTicketSnapshot({
    snapshotId: 'idempotency-123',
    exchangeName: '',
    exchangeId: null,
    customerName: 'Cliente <script>&',
    createdAt: '2026-07-27T20:35:00.000Z',
    deliveryLines: [
      { productId: 10, productName: 'Coca <script> & Cola', qty: 2 },
    ],
    mermaLines: [
      { productId: 11, productName: 'Agua & <b>1 L</b>', qty: 1 },
    ],
    notes: 'Envases <script> & dañados',
  });

  const html = buildExchangeTicketHtml(snapshot);

  assert.match(html, /TICKET DE CAMBIO/);
  assert.match(html, /Grupo Frio/);
  assert.match(html, new RegExp(formatTicketDate('2026-07-27T20:35:00.000Z').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /Cliente &lt;script&gt;&amp;/);
  assert.match(html, /Coca &lt;script&gt; &amp; Cola/);
  assert.match(html, /Agua &amp; &lt;b&gt;1 L&lt;\/b&gt;/);
  assert.match(html, /Envases &lt;script&gt; &amp; dañados/);
  assert.match(html, /PRODUCTO ENTREGADO/);
  assert.match(html, /PRODUCTO RECOGIDO|MERMA/);
  assert.match(html, /Cambio registrado correctamente/);
  assert.doesNotMatch(html, /Subtotal|Total|Precio|Pago/i);
  assert.doesNotMatch(html, /Cliente <script>/);
});

test('getExchangeTicketStorageKey namespaces exchange tickets by snapshot id', () => {
  assert.equal(getExchangeTicketStorageKey('idempotency-123'), 'exchange-ticket:idempotency-123');
});
