import assert from 'node:assert/strict';
import test from 'node:test';

import { SALE_TICKET_BRANDING } from '../src/services/saleTicketBranding.ts';
import {
  SALE_TICKET_CREDIT_NOTE,
  SALE_TICKET_DEFAULT_SELLER,
  buildSaleTicketHtml,
  buildSaleTicketSnapshot,
} from '../src/services/saleTicket.ts';
import {
  formatQuantityAndUnitPrice,
  formatTotalKg,
} from '../src/services/saleTicketFormatting.ts';
import { buildThermalTicketDocument } from '../src/services/thermalTicketDocument.ts';

function buildSnapshot(
  paymentMethod: 'cash' | 'credit' | 'transfer',
  overrides: Partial<Parameters<typeof buildSaleTicketSnapshot>[0]> = {},
) {
  return buildSaleTicketSnapshot({
    saleId: 'sale_thermal_123',
    customerName: 'Abarrotes Centro',
    sellerName: 'María Pérez',
    paymentMethod,
    createdAt: '2026-07-21T16:30:00.000Z',
    lines: [
      { productId: 10, productName: 'Bolsa 5kg', qty: 2, price: 42.5, weight: 5 },
    ],
    ...overrides,
  });
}

test('buildThermalTicketDocument uses the exact sale id as its folio', () => {
  const snapshot = buildSnapshot('cash', { saleId: 'op:123/á-raw' });

  assert.equal(buildThermalTicketDocument(snapshot).folio, snapshot.saleId);
});

test('buildThermalTicketDocument carries canonical branding without duplicating fiscal identity', () => {
  const document = buildThermalTicketDocument(buildSnapshot('cash'));

  assert.deepEqual(document.branding, {
    logoPngBase64: SALE_TICKET_BRANDING.logoPngBase64,
    logoVersion: SALE_TICKET_BRANDING.version,
    legalName: SALE_TICKET_BRANDING.legalName,
    rfcLabel: SALE_TICKET_BRANDING.rfcLabel,
    title: SALE_TICKET_BRANDING.title,
    footer: SALE_TICKET_BRANDING.footer,
  });
  assert.equal(document.schemaVersion, 1);
});

test('buildThermalTicketDocument preserves labels and credit-note policy for each payment method', () => {
  const cash = buildThermalTicketDocument(buildSnapshot('cash'));
  const credit = buildThermalTicketDocument(buildSnapshot('credit'));
  const transfer = buildThermalTicketDocument(buildSnapshot('transfer'));

  assert.equal(cash.paymentLabel, 'Efectivo');
  assert.equal(cash.creditNote, undefined);
  assert.equal(credit.paymentLabel, 'Credito');
  assert.equal(credit.creditNote, SALE_TICKET_CREDIT_NOTE);
  assert.equal(transfer.paymentLabel, 'Transferencia');
  assert.equal(transfer.creditNote, undefined);
});

test('buildThermalTicketDocument preserves an invalid date and supplies the missing seller fallback', () => {
  const snapshot = buildSnapshot('cash', {
    createdAt: 'fecha-no-valida',
    sellerName: undefined,
  });

  const document = buildThermalTicketDocument(snapshot);

  assert.equal(document.formattedDate, 'fecha-no-valida');
  assert.equal(document.sellerName, SALE_TICKET_DEFAULT_SELLER);
});

test('buildThermalTicketDocument formats integer and decimal quantities for drawing', () => {
  const document = buildThermalTicketDocument(buildSnapshot('cash', {
    lines: [
      { productId: 1, productName: 'Entero', qty: 2, price: 10, weight: 1 },
      { productId: 2, productName: 'Decimal', qty: 1.25, price: 12.5, weight: 0.5 },
    ],
  }));

  assert.equal(document.lines[0].quantityAndUnitPrice, '2 x $10.00');
  assert.equal(document.lines[0].lineTotal, '$20.00');
  assert.equal(document.lines[1].quantityAndUnitPrice, '1.25 x $12.50');
  assert.equal(document.lines[1].lineTotal, '$15.63');
});

test('shared compound formatting keeps thermal and PDF quantity and kg text equivalent', () => {
  const snapshot = buildSnapshot('cash', {
    lines: [
      { productId: 1, productName: 'Entero', qty: 2, price: 10, weight: 1 },
      { productId: 2, productName: 'Decimal', qty: 1.25, price: 12.5, weight: 0.5 },
    ],
  });
  const document = buildThermalTicketDocument(snapshot);
  const html = buildSaleTicketHtml(snapshot);

  assert.equal(formatQuantityAndUnitPrice(2, 10), '2 x $10.00');
  assert.equal(formatQuantityAndUnitPrice(1.25, 12.5), '1.25 x $12.50');
  assert.equal(formatTotalKg(snapshot.totalKg), '2.6 kg');
  assert.equal(document.lines[0].quantityAndUnitPrice, formatQuantityAndUnitPrice(2, 10));
  assert.equal(document.lines[1].quantityAndUnitPrice, formatQuantityAndUnitPrice(1.25, 12.5));
  assert.equal(document.totalKg, formatTotalKg(snapshot.totalKg));
  assert.ok(html.includes(document.lines[0].quantityAndUnitPrice));
  assert.ok(html.includes(document.lines[1].quantityAndUnitPrice));
  assert.ok(html.includes(document.totalKg));
});

test('buildThermalTicketDocument preserves Spanish characters and long names', () => {
  const customerName = 'Comercializadora Peña, Muñoz y Compañía de México con un nombre extraordinariamente largo';
  const productName = 'Hielo cristalino para celebración, piñata y reunión familiar en presentación extralarga';
  const document = buildThermalTicketDocument(buildSnapshot('cash', {
    customerName,
    sellerName: 'José Ángel Núñez',
    lines: [
      { productId: 99, productName, qty: 1, price: 50, weight: 5 },
    ],
  }));

  assert.equal(document.customerName, customerName);
  assert.equal(document.sellerName, 'José Ángel Núñez');
  assert.equal(document.lines[0].productName, productName);
});

test('buildThermalTicketDocument formats large totals and kilograms before native rendering', () => {
  const document = buildThermalTicketDocument(buildSnapshot('cash', {
    lines: [
      {
        productId: 100,
        productName: 'Pedido mayoreo',
        qty: 2,
        price: 1_234_567.89,
        weight: 12_345.67,
      },
    ],
  }));

  assert.equal(document.subtotal, '$2,469,135.78');
  assert.equal(document.total, '$2,469,135.78');
  assert.equal(document.totalKg, '24691.3 kg');
});
