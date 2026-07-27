import assert from 'node:assert/strict';
import test from 'node:test';

import { SALE_TICKET_BRANDING } from '../src/services/saleTicketBranding.ts';
import { formatQuantity, formatTicketDate } from '../src/services/saleTicketFormatting.ts';
import { buildExchangeTicketSnapshot } from '../src/services/exchangeTicket.ts';
import { buildExchangeThermalTicketDocument } from '../src/services/exchangeThermalTicketDocument.ts';

function buildSnapshot() {
  return buildExchangeTicketSnapshot({
    snapshotId: 'exchange-snapshot-123',
    exchangeName: '',
    exchangeId: 321,
    customerName: 'Miscelánea Peña',
    createdAt: '2026-07-27T20:35:00.000Z',
    deliveryLines: [
      { productId: 10, productName: 'Bolsa de hielo', qty: 2 },
      { productId: 11, productName: 'Hielo premium', qty: 1.5 },
    ],
    mermaLines: [
      { productId: 12, productName: 'Bolsa rota', qty: 3.25 },
    ],
    notes: 'Cambio por merma en ruta',
  });
}

test('buildExchangeThermalTicketDocument builds a schemaVersion 1 exchange payload with canonical branding and neutral totals', () => {
  const snapshot = buildSnapshot();

  const document = buildExchangeThermalTicketDocument(snapshot);

  assert.equal(document.schemaVersion, 1);
  assert.equal(document.ticketKind, 'exchange');
  assert.deepEqual(document.branding, {
    logoPngBase64: SALE_TICKET_BRANDING.logoPngBase64,
    logoVersion: SALE_TICKET_BRANDING.version,
    legalName: SALE_TICKET_BRANDING.legalName,
    rfcLabel: SALE_TICKET_BRANDING.rfcLabel,
    title: 'TICKET DE CAMBIO',
    footer: SALE_TICKET_BRANDING.footer,
  });
  assert.equal(document.folio, snapshot.folio);
  assert.equal(document.formattedDate, formatTicketDate(snapshot.createdAt));
  assert.equal(document.customerName, snapshot.customerName);
  assert.equal(document.sellerName, '—');
  assert.equal(document.paymentLabel, 'No aplica');
  assert.equal(document.subtotal, '—');
  assert.equal(document.totalKg, '—');
  assert.equal(document.total, 'No aplica');
  assert.equal(document.exchangeNotes, snapshot.notes);
});

test('buildExchangeThermalTicketDocument keeps delivery and merma lines distinct and formats quantities per section', () => {
  const snapshot = buildSnapshot();

  const document = buildExchangeThermalTicketDocument(snapshot);

  assert.deepEqual(document.lines, [
    {
      productId: 10,
      productName: 'Bolsa de hielo',
      quantityAndUnitPrice: `Cantidad: ${formatQuantity(2)}`,
      lineTotal: '—',
      sectionLabel: 'ENTREGA',
    },
    {
      productId: 11,
      productName: 'Hielo premium',
      quantityAndUnitPrice: `Cantidad: ${formatQuantity(1.5)}`,
      lineTotal: '—',
      sectionLabel: 'ENTREGA',
    },
    {
      productId: 12,
      productName: 'Bolsa rota',
      quantityAndUnitPrice: `Cantidad: ${formatQuantity(3.25)}`,
      lineTotal: '—',
      sectionLabel: 'MERMA',
    },
  ]);
});
