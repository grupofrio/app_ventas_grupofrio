import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSaleTicketSnapshot, SALE_TICKET_CREDIT_NOTE } from '../src/services/saleTicket.ts';
import { getSaleTicketPdfHeight } from '../src/services/saleTicketPdfHeight.ts';

function snapshot(paymentMethod: 'cash' | 'credit' = 'cash') {
  return buildSaleTicketSnapshot({
    saleId: 'sale_pdf',
    customerName: 'Cliente',
    sellerName: 'Vendedor',
    paymentMethod,
    createdAt: '2026-07-21T16:30:00.000Z',
    lines: [{ productId: 1, productName: 'Producto', qty: 1, price: 10, weight: 1 }],
  });
}

test('PDF height reserves the readable base and one product row', () => {
  assert.equal(getSaleTicketPdfHeight(snapshot()), 388);
});

test('PDF height reserves credit note wrapping in addition to the credit block', () => {
  const extraCreditRows = Math.max(1, Math.ceil(SALE_TICKET_CREDIT_NOTE.length / 26)) - 1;

  assert.equal(
    getSaleTicketPdfHeight(snapshot('credit')),
    388 + 90 + extraCreditRows * 18,
  );
});

test('PDF height grows for long customer and product content', () => {
  const longSnapshot = buildSaleTicketSnapshot({
    saleId: 'sale_pdf_long',
    customerName: 'Cliente con un nombre suficientemente largo para envolver en varias líneas',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    createdAt: '2026-07-21T16:30:00.000Z',
    lines: [{
      productId: 1,
      productName: 'Producto con un nombre suficientemente largo para envolver en varias líneas',
      qty: 1,
      price: 10,
      weight: 1,
    }],
  });

  assert.ok(getSaleTicketPdfHeight(longSnapshot) > getSaleTicketPdfHeight(snapshot()));
});
