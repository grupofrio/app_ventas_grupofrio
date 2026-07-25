import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSaleTicketSnapshotFromOrder,
  buildSaleTicketHtml,
  buildSaleTicketSnapshot,
  createSaleTicketOpenGuard,
  getSaleTicketStorageKey,
  parseSaleTicketSnapshot,
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
  assert.equal(snapshot.origin, 'odoo');
  assert.equal(snapshot.lines[0].productName, 'Bolsa 5kg');
  assert.equal(snapshot.lines[0].qty, 2);
  assert.equal(snapshot.lines[0].lineTotal, 80);
  assert.equal(snapshot.lines[1].productName, 'Hielo 3kg');
  assert.equal(snapshot.totalKg, 18);
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
