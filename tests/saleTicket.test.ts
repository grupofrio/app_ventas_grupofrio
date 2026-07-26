import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSaleTicketSnapshotFromOrder,
  buildSaleTicketHtml,
  buildSaleTicketSnapshot,
  createSaleTicketOpenGuard,
  getSaleTicketFolioPresentation,
  getSaleTicketStorageKey,
  mergeSaleTicketFromOrder,
  parseSaleTicketSnapshot,
  type SaleTicketOrderSource,
  withSaleTicketOdooFolio,
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

test('buildSaleTicketSnapshot preserves optional captured price provenance without changing money', () => {
  const withoutMetadata = buildSaleTicketSnapshot({
    saleId: 'sale_price_metadata',
    customerName: 'Abarrotes Centro',
    sellerName: 'Juan Perez',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [
      { productId: 10, productName: 'Bolsa 5kg', qty: 2, price: 42.5, weight: 5 },
      { productId: 20, productName: 'Hielo 3kg', qty: 1, price: 30, weight: 3 },
    ],
  });
  const withMetadata = buildSaleTicketSnapshot({
    saleId: 'sale_price_metadata',
    customerName: 'Abarrotes Centro',
    sellerName: 'Juan Perez',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [
      {
        productId: 10,
        productName: 'Bolsa 5kg',
        qty: 2,
        price: 42.5,
        weight: 5,
        priceSource: 'prepared_customer',
        priceCapturedAtMs: 1_753_350_000_000,
        pricelistId: 81,
      },
      {
        productId: 20,
        productName: 'Hielo 3kg',
        qty: 1,
        price: 30,
        weight: 3,
        priceSource: 'public_fallback',
        priceCapturedAtMs: null,
        pricelistId: null,
      },
    ],
  });
  const roundTrip = JSON.parse(JSON.stringify(withMetadata));

  assert.equal(withMetadata.origin, 'local');
  assert.deepEqual(roundTrip.lines[0], {
    productId: 10,
    productName: 'Bolsa 5kg',
    qty: 2,
    unitPrice: 42.5,
    lineTotal: 85,
    weight: 5,
    priceSource: 'prepared_customer',
    priceCapturedAtMs: 1_753_350_000_000,
    pricelistId: 81,
  });
  assert.equal(roundTrip.lines[1].priceSource, 'public_fallback');
  assert.equal(roundTrip.lines[1].priceCapturedAtMs, null);
  assert.equal(roundTrip.lines[1].pricelistId, null);
  assert.deepEqual(
    {
      subtotal: withMetadata.subtotal,
      total: withMetadata.total,
      totalKg: withMetadata.totalKg,
      lineTotals: withMetadata.lines.map((line) => line.lineTotal),
      unitPrices: withMetadata.lines.map((line) => line.unitPrice),
    },
    {
      subtotal: withoutMetadata.subtotal,
      total: withoutMetadata.total,
      totalKg: withoutMetadata.totalKg,
      lineTotals: withoutMetadata.lines.map((line) => line.lineTotal),
      unitPrices: withoutMetadata.lines.map((line) => line.unitPrice),
    },
  );
  assert.equal(buildSaleTicketHtml(withMetadata), buildSaleTicketHtml(withoutMetadata));
});

test('legacy ticket snapshots without origin or price metadata still render normally', () => {
  const legacySnapshot = {
    saleId: 'sale_legacy',
    customerName: 'Cliente Legacy',
    sellerName: 'Vendedor',
    paymentMethod: 'cash' as const,
    paymentLabel: 'Efectivo',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [{
      productId: 10,
      productName: 'Bolsa 5kg',
      qty: 2,
      unitPrice: 42.5,
      lineTotal: 85,
      weight: 5,
    }],
    subtotal: 85,
    total: 85,
    totalKg: 10,
  };

  assert.doesNotThrow(() => buildSaleTicketHtml(legacySnapshot));
  assert.match(buildSaleTicketHtml(legacySnapshot), /\$85\.00/);
});

test('buildSaleTicketSnapshot presents a pending Odoo folio with the local reference', () => {
  const snapshot = buildSaleTicketSnapshot({
    saleId: 'mobile-op-1',
    customerName: 'Abarrotes Centro',
    sellerName: 'Juan Perez',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [],
  });

  assert.equal(snapshot.odooFolio, null);
  assert.deepEqual(getSaleTicketFolioPresentation(snapshot), {
    odooFolio: 'Pendiente por sincronizar',
    localReference: 'mobile-op-1',
  });
});

test('withSaleTicketOdooFolio stores a normalized official folio without changing the local identity', () => {
  const pending = buildSaleTicketSnapshot({
    saleId: 'mobile-op-1',
    customerName: 'Abarrotes Centro',
    sellerName: 'Juan Perez',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [],
  });

  assert.equal(pending.odooFolio, null);

  const synchronized = withSaleTicketOdooFolio(pending, '  S00042  ');

  assert.equal(synchronized.saleId, 'mobile-op-1');
  assert.equal(synchronized.odooFolio, 'S00042');
  assert.deepEqual(getSaleTicketFolioPresentation(synchronized), {
    odooFolio: 'S00042',
    localReference: null,
  });
});

test('withSaleTicketOdooFolio leaves a pending snapshot unchanged for a blank folio', () => {
  const pending = buildSaleTicketSnapshot({
    saleId: 'mobile-op-1',
    customerName: 'Abarrotes Centro',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [],
  });

  assert.strictEqual(withSaleTicketOdooFolio(pending, '   '), pending);
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
  assert.match(html, /src="data:image\/png;base64,/);
  assert.match(html, /alt="Grupo Frio"/);
  assert.match(html, /SOLUCIONES EN PRODUCCION GLACIEM/);
  assert.match(html, /RFC:\s*SPG230420F52/);
  assert.match(html, /size:\s*58mm auto/);
  assert.match(html, /width:\s*58mm/);
  assert.match(html, /body\s*\{[^}]*padding:\s*4mm 0;/);
  assert.match(html, /Cliente &amp; Socios &lt;test&gt;/);
  assert.match(html, /Vendedor &amp; Uno &lt;test&gt;/);
  assert.match(html, /Bolsa &lt;5kg&gt; &amp; hielo/);
  assert.match(html, /sale_&lt;abc&gt;/);
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

test('buildSaleTicketHtml shows only the official Odoo folio after synchronization', () => {
  const snapshot = buildSaleTicketSnapshot({
    saleId: 'mobile-op-1',
    odooFolio: 'S00042',
    customerName: 'Abarrotes Centro',
    sellerName: 'Juan Perez',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [],
  });

  const html = buildSaleTicketHtml(snapshot);

  assert.match(html, /<span>Folio Odoo<\/span><span>S00042<\/span>/);
  assert.doesNotMatch(html, /Referencia local/);
  assert.doesNotMatch(html, /mobile-op-1/);
});

test('buildSaleTicketHtml identifies a pending Odoo folio with its local reference', () => {
  const snapshot = buildSaleTicketSnapshot({
    saleId: 'mobile-op-1',
    customerName: 'Abarrotes Centro',
    sellerName: 'Juan Perez',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [],
  });

  const html = buildSaleTicketHtml(snapshot);

  assert.match(
    html,
    /<span>Folio Odoo<\/span><span>Pendiente por sincronizar<\/span>/,
  );
  assert.match(html, /<span>Referencia local<\/span><span>mobile-op-1<\/span>/);
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
  assert.equal(snapshot.odooFolio, 'S00042');
  assert.equal(snapshot.customerName, 'Cliente Ruta');
  assert.equal(snapshot.paymentLabel, 'No especificado');
  assert.equal(snapshot.lines.length, 1);
  assert.equal(snapshot.lines[0].productName, 'Venta S00042');
  assert.equal(snapshot.lines[0].lineTotal, 250);
  assert.equal(snapshot.totalKg, 18);
});

test('buildSaleTicketSnapshotFromOrder keeps the local operation id when the Odoo name is blank', () => {
  const snapshot = buildSaleTicketSnapshotFromOrder({
    id: 42,
    name: '   ',
    operation_id: 'sale_abc',
    partner_name: 'Cliente Ruta',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
  });

  assert.equal(snapshot.saleId, 'sale_abc');
  assert.equal(snapshot.odooFolio, null);
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
  assert.equal(snapshot.origin, 'odoo');
  assert.equal(snapshot.lines[0].productName, 'Bolsa 5kg');
  assert.equal(snapshot.lines[0].qty, 2);
  assert.equal(snapshot.lines[0].lineTotal, 80);
  assert.equal(snapshot.lines[1].productName, 'Hielo 3kg');
  assert.equal(snapshot.totalKg, 18);
});

test('mergeSaleTicketFromOrder ignores malformed runtime lines instead of replacing the local ticket', () => {
  const current = buildSaleTicketSnapshot({
    saleId: 'mobile-op-malformed',
    customerName: 'Cliente local',
    sellerName: 'Vendedor local',
    paymentMethod: 'credit',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [{
      productId: 10,
      productName: 'Bolsa local',
      qty: 2,
      price: 42.5,
      weight: 5,
    }],
  });
  const runtimeLines = [
    null,
    'not-an-order-line',
    { quantity: 2 },
    { product_id: 10, quantity: 2 },
    { product_id: 10, product_name: 99, quantity: 2 },
  ] as unknown as SaleTicketOrderSource['lines'];

  const merged = mergeSaleTicketFromOrder(current, {
    id: 42,
    name: 'S00042',
    operation_id: 'mobile-op-malformed',
    partner_name: 'Cliente remoto',
    employee_name: 'Vendedor remoto',
    amount_untaxed: 999,
    amount_total: 1_158.84,
    kg_total: 99,
    confirmation_date: '2026-05-29T19:00:00.000Z',
    date_order: '2026-05-29T18:59:00.000Z',
    lines: runtimeLines,
  });

  assert.deepEqual(merged, {
    ...current,
    odooFolio: 'S00042',
    sellerName: 'Vendedor remoto',
  });
});

test('order snapshot building and merging use only runtime-valid lines from a mixed payload', () => {
  const current = buildSaleTicketSnapshot({
    saleId: 'mobile-op-mixed',
    customerName: 'Cliente local',
    sellerName: 'Vendedor local',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [{
      productId: 10,
      productName: 'Bolsa local',
      qty: 1,
      price: 42.5,
      weight: 5,
      priceSource: 'last_known_customer',
      priceCapturedAtMs: 1_753_350_000_000,
      pricelistId: 81,
    }],
  });
  const runtimeLines = [
    { quantity: 20, price_unit: 1, price_subtotal: 20 },
    {
      product_id: 20,
      product_name: 99,
      quantity: 1,
      price_unit: 30,
      price_subtotal: 30,
    },
    {
      product_id: 10,
      product_name: 'Bolsa oficial',
      quantity: 2,
      price_unit: 50,
      price_subtotal: 80,
      kg_total: 10,
    },
  ] as unknown as SaleTicketOrderSource['lines'];
  const order: SaleTicketOrderSource = {
    id: 43,
    name: 'S00043',
    operation_id: 'mobile-op-mixed',
    partner_name: 'Cliente oficial',
    amount_untaxed: 80,
    amount_total: 92.8,
    kg_total: 10,
    confirmation_date: '2026-05-29T19:00:00.000Z',
    date_order: '2026-05-29T18:59:00.000Z',
    lines: runtimeLines,
  };

  const built = buildSaleTicketSnapshotFromOrder(order);
  const merged = mergeSaleTicketFromOrder(current, order);

  assert.deepEqual(built.lines.map((line) => line.productId), [10]);
  assert.deepEqual(merged.lines, [{
    productId: 10,
    productName: 'Bolsa oficial',
    qty: 2,
    unitPrice: 40,
    lineTotal: 80,
    priceSource: 'last_known_customer',
    priceCapturedAtMs: 1_753_350_000_000,
    pricelistId: 81,
    weight: 5,
  }]);
  assert.equal(merged.origin, 'odoo');
  assert.equal(merged.subtotal, 80);
  assert.equal(merged.total, 92.8);
  assert.equal(merged.odooFolio, 'S00043');
});

test('buildSaleTicketSnapshotFromOrder preserves discounted and taxed Odoo money', () => {
  const snapshot = buildSaleTicketSnapshotFromOrder({
    id: 42,
    name: 'S00042',
    operation_id: 'sale_discounted',
    partner_name: 'Cliente Ruta',
    amount_untaxed: 80,
    amount_total: 92.8,
    kg_total: 10,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
    lines: [{
      product_id: 10,
      product_name: 'Bolsa 5kg',
      quantity: 2,
      price_unit: 50,
      price_subtotal: 80,
      kg_total: 10,
    }],
  });
  const html = buildSaleTicketHtml(snapshot);

  assert.equal(snapshot.lines[0].unitPrice, 40);
  assert.equal(snapshot.lines[0].lineTotal, 80);
  assert.equal(snapshot.subtotal, 80);
  assert.equal(snapshot.total, 92.8);
  assert.match(html, /\$40\.00/);
  assert.match(html, /\$80\.00/);
  assert.match(html, /\$92\.80/);
});

test('buildSaleTicketSnapshotFromOrder preserves free lines and bounds invalid money fallbacks', () => {
  const free = buildSaleTicketSnapshotFromOrder({
    id: 42,
    name: 'S00042',
    operation_id: 'sale_free',
    partner_name: 'Cliente Ruta',
    amount_untaxed: 0,
    amount_total: 0,
    kg_total: 0,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
    lines: [{
      product_id: 10,
      product_name: 'Muestra',
      quantity: 1,
      price_unit: 0,
      price_subtotal: 0,
      kg_total: 0,
    }],
  });
  const invalid = buildSaleTicketSnapshotFromOrder({
    id: 43,
    name: 'S00043',
    operation_id: 'sale_invalid_money',
    partner_name: 'Cliente Ruta',
    amount_untaxed: Number.NaN,
    amount_total: Number.POSITIVE_INFINITY,
    kg_total: -1,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
    lines: [{
      product_id: 11,
      product_name: 'Fallback',
      quantity: 1,
      price_unit: -10,
      price_subtotal: Number.NaN,
      kg_total: -5,
    }],
  });

  assert.equal(free.lines.length, 1);
  assert.equal(free.lines[0].unitPrice, 0);
  assert.equal(free.lines[0].lineTotal, 0);
  assert.equal(free.subtotal, 0);
  assert.equal(free.total, 0);
  assert.equal(free.totalKg, 0);

  assert.equal(invalid.lines[0].unitPrice, 0);
  assert.equal(invalid.lines[0].lineTotal, 0);
  assert.equal(invalid.subtotal, 0);
  assert.equal(invalid.total, 0);
  assert.equal(invalid.totalKg, 0);
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

test('mergeSaleTicketFromOrder refreshes authoritative folio and seller while preserving local ticket details', () => {
  const current = buildSaleTicketSnapshot({
    saleId: 'mobile-op-42',
    customerName: 'Cliente local completo',
    sellerName: 'Vendedor local',
    paymentMethod: 'credit',
    paymentLabel: 'Credito de ruta',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [
      { productId: 10, productName: 'Bolsa 5kg', qty: 2, price: 42.5, weight: 5 },
      { productId: 20, productName: 'Hielo 3kg', qty: 1, price: 30, weight: 3 },
    ],
  });

  const merged = mergeSaleTicketFromOrder(current, {
    id: 42,
    name: 'S00042',
    operation_id: 'mobile-op-42',
    partner_name: 'Cliente resumido de Odoo',
    employee_name: 'María López',
    amount_total: 999,
    kg_total: 99,
    confirmation_date: '2026-05-29T19:00:00.000Z',
    date_order: '2026-05-29T18:59:00.000Z',
  });

  assert.deepEqual(merged, {
    ...current,
    odooFolio: 'S00042',
    sellerName: 'María López',
  });
});

test('mergeSaleTicketFromOrder promotes definitive remote lines and money while retaining only missing local provenance', () => {
  const current = buildSaleTicketSnapshot({
    saleId: 'mobile-op-42',
    customerName: 'Cliente local',
    sellerName: 'Vendedor local',
    paymentMethod: 'credit',
    paymentLabel: 'Crédito local',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [
      {
        productId: 10,
        productName: 'Nombre local',
        qty: 2,
        price: 42.5,
        weight: 5,
        priceSource: 'last_known_customer',
        priceCapturedAtMs: 1_753_350_000_000,
        pricelistId: 81,
      },
      {
        productId: 20,
        productName: 'Sólo local',
        qty: 1,
        price: 30,
        weight: 3,
      },
    ],
  });
  const original = structuredClone(current);

  const merged = mergeSaleTicketFromOrder(current, {
    id: 42,
    name: 'S00042',
    operation_id: 'mobile-op-42',
    partner_name: 'Cliente oficial',
    employee_name: '   ',
    amount_untaxed: 150,
    amount_total: 174,
    kg_total: 18,
    confirmation_date: '2026-05-29T19:00:00.000Z',
    date_order: '2026-05-29T18:59:00.000Z',
    payment_method: 'cash',
    lines: [
      {
        product_id: 10,
        product_name: 'Nombre oficial',
        quantity: 3,
        price_unit: 50,
        price_subtotal: 120,
        kg_total: 15,
      },
      {
        product_id: 30,
        product_name: 'Sólo remoto',
        quantity: 1,
        price_unit: 30,
        price_subtotal: 30,
        kg_total: 3,
      },
    ],
  });

  assert.equal(merged.origin, 'odoo');
  assert.equal(merged.odooFolio, 'S00042');
  assert.equal(merged.customerName, 'Cliente oficial');
  assert.equal(merged.sellerName, 'Vendedor local');
  assert.equal(merged.paymentMethod, 'cash');
  assert.equal(merged.subtotal, 150);
  assert.equal(merged.total, 174);
  assert.equal(merged.totalKg, 18);
  assert.deepEqual(merged.lines.map((line) => line.productId), [10, 30]);
  assert.deepEqual(merged.lines[0], {
    productId: 10,
    productName: 'Nombre oficial',
    qty: 3,
    unitPrice: 40,
    lineTotal: 120,
    weight: 5,
    priceSource: 'last_known_customer',
    priceCapturedAtMs: 1_753_350_000_000,
    pricelistId: 81,
  });
  assert.equal(merged.lines[1].unitPrice, 30);
  assert.deepEqual(current, original, 'the local pricing snapshot must remain immutable');
});

test('mergeSaleTicketFromOrder replaces an earlier Odoo fallback when definitive lines arrive', () => {
  const current = buildSaleTicketSnapshotFromOrder({
    id: 42,
    name: 'S00041',
    operation_id: 'mobile-op-42',
    partner_name: 'Cliente Ruta',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
  });

  const merged = mergeSaleTicketFromOrder(current, {
    id: 42,
    name: 'S00042',
    operation_id: 'mobile-op-42',
    partner_name: 'Cliente Ruta',
    amount_untaxed: 80,
    amount_total: 92.8,
    kg_total: 10,
    confirmation_date: '2026-05-29T19:00:00.000Z',
    date_order: '2026-05-29T18:59:00.000Z',
    lines: [{
      product_id: 10,
      product_name: 'Bolsa 5kg',
      quantity: 2,
      price_unit: 50,
      price_subtotal: 80,
      kg_total: 10,
    }],
  });

  assert.equal(merged.origin, 'odoo');
  assert.equal(merged.odooFolio, 'S00042');
  assert.equal(merged.lines.length, 1);
  assert.equal(merged.lines[0].productId, 10);
  assert.equal(merged.lines[0].unitPrice, 40);
  assert.equal(merged.lines[0].lineTotal, 80);
  assert.equal(merged.subtotal, 80);
  assert.equal(merged.total, 92.8);
});

test('mergeSaleTicketFromOrder preserves a meaningful seller when the order employee is blank', () => {
  const current = buildSaleTicketSnapshot({
    saleId: 'mobile-op-42',
    customerName: 'Cliente local',
    sellerName: 'Vendedor original',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [],
  });

  const merged = mergeSaleTicketFromOrder(current, {
    id: 42,
    name: 'S00042',
    operation_id: 'mobile-op-42',
    partner_name: 'Cliente local',
    employee_name: '   ',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
  });

  assert.equal(merged.sellerName, 'Vendedor original');
});

test('mergeSaleTicketFromOrder builds an authoritative ticket when no local snapshot exists', () => {
  const order = {
    id: 42,
    name: 'S00042',
    operation_id: 'mobile-op-42',
    partner_name: 'Cliente Ruta',
    employee_name: '   ',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
  };

  const merged = mergeSaleTicketFromOrder(null, order);

  assert.deepEqual(merged, buildSaleTicketSnapshotFromOrder(order));
  assert.equal(merged.sellerName, 'Vendedor no especificado');
});

test('mergeSaleTicketFromOrder preserves an official folio when the order name is blank', () => {
  const current = {
    ...buildSaleTicketSnapshot({
      saleId: 'mobile-op-42',
      odooFolio: 'S00042',
      customerName: 'Cliente local',
      sellerName: 'Vendedor original',
      paymentMethod: 'cash',
      createdAt: '2026-05-28T18:30:00.000Z',
      lines: [],
    }),
  };

  const merged = mergeSaleTicketFromOrder(current, {
    id: 42,
    name: '   ',
    operation_id: 'mobile-op-42',
    partner_name: 'Cliente local',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
  });

  assert.equal(merged.odooFolio, 'S00042');
});

test('mergeSaleTicketFromOrder accepts a later nonblank authoritative Odoo folio', () => {
  const current = buildSaleTicketSnapshot({
    saleId: 'mobile-op-42',
    odooFolio: 'S00042',
    customerName: 'Cliente local',
    sellerName: 'Vendedor original',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [],
  });

  const merged = mergeSaleTicketFromOrder(current, {
    id: 42,
    name: 'S00084',
    operation_id: 'mobile-op-42',
    partner_name: 'Cliente local',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
  });

  assert.equal(merged.odooFolio, 'S00084');
});

test('getSaleTicketStorageKey namespaces tickets by sale id', () => {
  assert.equal(getSaleTicketStorageKey('sale_123'), 'sale-ticket:sale_123');
});

test('parseSaleTicketSnapshot restores a defensive legacy-compatible copy', () => {
  const current = buildSaleTicketSnapshot({
    saleId: 'sale_parser',
    customerName: 'Cliente',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [{
      productId: 10,
      productName: 'Bolsa 5kg',
      qty: 2,
      price: 42.5,
      weight: 5,
      priceSource: 'last_known_customer',
      priceCapturedAtMs: 1_753_350_000_000,
      pricelistId: 81,
    }],
  });
  const legacy = { ...current };
  delete legacy.origin;

  const restored = parseSaleTicketSnapshot(legacy, ' sale_parser ');

  assert.deepEqual(restored, legacy);
  assert.notStrictEqual(restored, legacy);
  assert.notStrictEqual(restored?.lines, legacy.lines);
  assert.notStrictEqual(restored?.lines[0], legacy.lines[0]);
  assert.equal(restored?.origin, undefined);
});

test('parseSaleTicketSnapshot rejects malformed full snapshots and exact-id mismatches', () => {
  const valid = buildSaleTicketSnapshot({
    saleId: 'sale_parser',
    customerName: 'Cliente',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [{
      productId: 10,
      productName: 'Bolsa 5kg',
      qty: 2,
      price: 42.5,
      weight: 5,
      priceSource: 'prepared_customer',
      priceCapturedAtMs: 1_753_350_000_000,
      pricelistId: 81,
    }],
  });
  const invalidSnapshots: unknown[] = [
    { ...valid, lines: undefined },
    { ...valid, total: undefined },
    { ...valid, origin: 'server' },
    { ...valid, customerName: null },
    { ...valid, paymentMethod: 'card' },
    { ...valid, subtotal: -1 },
    { ...valid, total: Number.POSITIVE_INFINITY },
    { ...valid, totalKg: -1 },
    { ...valid, saleId: ' sale_parser ' },
    { ...valid, lines: [{ ...valid.lines[0], productId: 0 }] },
    { ...valid, lines: [{ ...valid.lines[0], productId: 1.5 }] },
    { ...valid, lines: [{ ...valid.lines[0], qty: 0 }] },
    { ...valid, lines: [{ ...valid.lines[0], unitPrice: -1 }] },
    { ...valid, lines: [{ ...valid.lines[0], lineTotal: Number.NaN }] },
    { ...valid, lines: [{ ...valid.lines[0], weight: -1 }] },
    { ...valid, lines: [{ ...valid.lines[0], priceSource: 'guessed' }] },
    { ...valid, lines: [{ ...valid.lines[0], priceCapturedAtMs: -1 }] },
    { ...valid, lines: [{ ...valid.lines[0], pricelistId: 0 }] },
  ];

  for (const snapshot of invalidSnapshots) {
    assert.equal(parseSaleTicketSnapshot(snapshot, 'sale_parser'), null);
  }
  assert.equal(parseSaleTicketSnapshot(valid, '   '), null);
  assert.equal(parseSaleTicketSnapshot(valid, 'sale_other'), null);
});

test('sale ticket open guard deduplicates normalized operation ids and releases after handoff', async () => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const guard = createSaleTicketOpenGuard();
  let calls = 0;

  const first = guard.run(' sale-op-1 ', async () => {
    calls += 1;
    await firstGate;
  });
  const duplicate = await guard.run('sale-op-1', async () => {
    calls += 1;
  });

  assert.equal(duplicate, false);
  assert.equal(calls, 1);
  releaseFirst();
  assert.equal(await first, true);
  assert.equal(await guard.run('sale-op-1', async () => {
    calls += 1;
  }), true);
  assert.equal(calls, 2);
  assert.equal(await guard.run('   ', async () => {
    calls += 1;
  }), false);
  assert.equal(calls, 2);
});

test('sale ticket open guard releases an operation id after failure', async () => {
  const guard = createSaleTicketOpenGuard();

  await assert.rejects(
    guard.run('sale-op-1', async () => {
      throw new Error('save failed');
    }),
    /save failed/,
  );
  assert.equal(await guard.run('sale-op-1', async () => {}), true);
});
