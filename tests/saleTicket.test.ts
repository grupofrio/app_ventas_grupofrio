import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSaleTicketSnapshotFromOrder,
  buildSaleTicketHtml,
  buildSaleTicketSnapshot,
  getSaleTicketStorageKey,
} from '../src/services/saleTicket.ts';

test('buildSaleTicketSnapshot preserves sale data for a local 58mm ticket', () => {
  const snapshot = buildSaleTicketSnapshot({
    saleId: 'sale_123',
    customerName: 'Abarrotes Centro',
    sellerName: 'Juan Perez',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [
      { productId: 10, productName: 'Bolsa 5kg', qty: 2, price: 42.5, weight: 5 },
      { productId: 20, productName: 'Hielo 3kg', qty: 1, price: 30, weight: 3 },
    ],
  });

  assert.equal(snapshot.saleId, 'sale_123');
  assert.equal(snapshot.customerName, 'Abarrotes Centro');
  assert.equal(snapshot.sellerName, 'Juan Perez');
  assert.equal(snapshot.paymentLabel, 'Efectivo');
  assert.equal(snapshot.lines[0].lineTotal, 85);
  assert.equal(snapshot.subtotal, 115);
  assert.equal(snapshot.total, 115);
  assert.equal(snapshot.totalKg, 13);
});

test('buildSaleTicketHtml creates escaped 58mm receipt markup', () => {
  const snapshot = buildSaleTicketSnapshot({
    saleId: 'sale_<abc>',
    customerName: 'Cliente & Socios <test>',
    sellerName: 'Vendedor & Uno <test>',
    paymentMethod: 'credit',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [
      { productId: 10, productName: 'Bolsa <5kg> & hielo', qty: 2, price: 42.5, weight: 5 },
    ],
  });

  const html = buildSaleTicketHtml(snapshot);

  assert.match(html, /<img class="brand-logo"/);
  assert.match(html, /src="data:image\/svg\+xml/);
  assert.match(html, /alt="Grupo Frio"/);
  assert.match(html, /SOLUCIONES EN PRODUCCION GLACIEM/);
  assert.match(html, /RFC:\s*SPG230420F52/);
  assert.match(html, /size:\s*58mm auto/);
  assert.match(html, /width:\s*58mm/);
  assert.match(html, /Cliente &amp; Socios &lt;test&gt;/);
  assert.match(html, /Vendedor &amp; Uno &lt;test&gt;/);
  assert.match(html, /Bolsa &lt;5kg&gt; &amp; hielo/);
  assert.match(html, /Cr[eé]dito/);
  assert.match(html, /Pagar[eé]/);
  assert.match(html, /SOLUCIONES EN PRODUCCION GLACIEM/);
  assert.match(html, /SPG230420F52/);
  assert.match(html, /cantidad total indicada en este ticket/);
  assert.doesNotMatch(html, /oficina/i);
  assert.doesNotMatch(html, /Cuajimalpa/i);
  assert.match(html, /\$85\.00/);
  assert.doesNotMatch(html, /Cliente & Socios <test>/);
});

test('buildSaleTicketHtml omits credit promissory note for cash tickets', () => {
  const snapshot = buildSaleTicketSnapshot({
    saleId: 'sale_123',
    customerName: 'Abarrotes Centro',
    sellerName: 'Juan Perez',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [
      { productId: 10, productName: 'Bolsa 5kg', qty: 2, price: 42.5, weight: 5 },
    ],
  });

  const html = buildSaleTicketHtml(snapshot);

  assert.doesNotMatch(html, /Pagar[eé]/);
  assert.doesNotMatch(html, /cantidad total indicada en este ticket/);
});

test('buildSaleTicketSnapshotFromOrder preserves payment method from sales list rows', () => {
  const snapshot = buildSaleTicketSnapshotFromOrder({
    id: 42,
    name: 'S00042',
    operation_id: 'sale_abc',
    partner_name: 'Cliente Ruta',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
    payment_method: 'cash',
    employee_name: 'Maria Lopez',
  });

  assert.equal(snapshot.paymentMethod, 'cash');
  assert.equal(snapshot.paymentLabel, 'Efectivo');
  assert.equal(snapshot.sellerName, 'Maria Lopez');
});

test('buildSaleTicketSnapshotFromOrder prefers payment method label when available', () => {
  const snapshot = buildSaleTicketSnapshotFromOrder({
    id: 42,
    name: 'S00042',
    operation_id: 'sale_abc',
    partner_name: 'Cliente Ruta',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
    payment_method: 'card',
    payment_method_label: 'Tarjeta',
  });

  assert.equal(snapshot.paymentMethod, 'unknown');
  assert.equal(snapshot.paymentLabel, 'Tarjeta');
});

test('buildSaleTicketSnapshotFromOrder creates printable fallback from sales list rows', () => {
  const snapshot = buildSaleTicketSnapshotFromOrder({
    id: 42,
    name: 'S00042',
    operation_id: 'sale_abc',
    partner_name: 'Cliente Ruta',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
  });

  assert.equal(snapshot.saleId, 'sale_abc');
  assert.equal(snapshot.customerName, 'Cliente Ruta');
  assert.equal(snapshot.paymentLabel, 'No especificado');
  assert.equal(snapshot.lines.length, 1);
  assert.equal(snapshot.lines[0].productName, 'Venta S00042');
  assert.equal(snapshot.lines[0].lineTotal, 250);
  assert.equal(snapshot.totalKg, 18);
});

test('buildSaleTicketSnapshotFromOrder uses real order lines when available', () => {
  const snapshot = buildSaleTicketSnapshotFromOrder({
    id: 42,
    name: 'S00042',
    operation_id: 'sale_abc',
    partner_name: 'Cliente Ruta',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
    lines: [
      {
        product_id: 10,
        product_name: 'Bolsa 5kg',
        quantity: 2,
        price_unit: 40,
        price_subtotal: 80,
        kg_total: 10,
      },
      {
        product_id: 20,
        product_name: 'Hielo 3kg',
        quantity: 3,
        price_unit: 30,
        price_subtotal: 90,
        kg_total: 8,
      },
    ],
  });

  assert.equal(snapshot.lines.length, 2);
  assert.equal(snapshot.lines[0].productName, 'Bolsa 5kg');
  assert.equal(snapshot.lines[0].qty, 2);
  assert.equal(snapshot.lines[0].lineTotal, 80);
  assert.equal(snapshot.lines[1].productName, 'Hielo 3kg');
  assert.equal(snapshot.totalKg, 18);
});

test('buildSaleTicketSnapshotFromOrder falls back to order id when operation id is missing', () => {
  const snapshot = buildSaleTicketSnapshotFromOrder({
    id: 42,
    name: 'S00042',
    operation_id: '',
    partner_name: '',
    amount_total: 250,
    kg_total: 0,
    confirmation_date: '',
    date_order: '',
  });

  assert.equal(snapshot.saleId, 'odoo-order-42');
  assert.equal(snapshot.customerName, 'Cliente sin nombre');
});

test('getSaleTicketStorageKey namespaces tickets by sale id', () => {
  assert.equal(getSaleTicketStorageKey('sale_123'), 'sale-ticket:sale_123');
});
