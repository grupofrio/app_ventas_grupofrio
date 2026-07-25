import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSaleTicketSnapshot,
  type SaleTicketOrderSource,
  type SaleTicketSnapshot,
} from '../src/services/saleTicket.ts';
import {
  openSaleTicketForOrder,
  type SaleTicketOpenDependencies,
} from '../src/services/saleTicketOpen.ts';

function order(
  overrides: Partial<SaleTicketOrderSource> = {},
): SaleTicketOrderSource {
  return {
    id: 42,
    name: 'S00042',
    operation_id: 'mobile-op-42',
    partner_name: 'Cliente Ruta',
    employee_name: 'María López',
    amount_total: 250,
    kg_total: 18,
    confirmation_date: '2026-05-28T19:00:00.000Z',
    date_order: '2026-05-28T18:59:00.000Z',
    ...overrides,
  };
}

function currentTicket(): SaleTicketSnapshot {
  return buildSaleTicketSnapshot({
    saleId: 'mobile-op-42',
    customerName: 'Cliente local completo',
    sellerName: 'Vendedor local',
    paymentMethod: 'credit',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [
      { productId: 10, productName: 'Bolsa 5kg', qty: 2, price: 42.5, weight: 5 },
    ],
  });
}

test('openSaleTicketForOrder strictly loads, saves, then navigates with the merged ticket', async () => {
  const events: string[] = [];
  const feedback: unknown[] = [];
  let saved: SaleTicketSnapshot | undefined;
  const dependencies: SaleTicketOpenDependencies = {
    async load(saleId) {
      events.push(`load:${saleId}`);
      return currentTicket();
    },
    async save(ticket) {
      events.push(`save:${ticket.saleId}`);
      saved = ticket;
    },
    navigate(saleId) {
      events.push(`navigate:${saleId}`);
    },
    onError(error) {
      feedback.push(error);
    },
  };

  const result = await openSaleTicketForOrder(order(), dependencies);

  assert.equal(result, 'opened');
  assert.deepEqual(events, [
    'load:mobile-op-42',
    'save:mobile-op-42',
    'navigate:mobile-op-42',
  ]);
  assert.deepEqual(feedback, []);
  assert.equal(saved?.odooFolio, 'S00042');
  assert.equal(saved?.sellerName, 'María López');
  assert.equal(saved?.lines[0]?.productName, 'Bolsa 5kg');
});

test('openSaleTicketForOrder reports a strict load failure without saving or navigating', async () => {
  const failure = new Error('strict load failed');
  let saveCalled = false;
  let navigateCalled = false;
  const feedback: unknown[] = [];

  const result = await openSaleTicketForOrder(order(), {
    async load() {
      throw failure;
    },
    async save() {
      saveCalled = true;
    },
    navigate() {
      navigateCalled = true;
    },
    onError(error) {
      feedback.push(error);
    },
  });

  assert.equal(result, 'failed');
  assert.equal(saveCalled, false);
  assert.equal(navigateCalled, false);
  assert.deepEqual(feedback, [failure]);
});

test('openSaleTicketForOrder reports a strict save failure without navigating', async () => {
  const failure = new Error('strict save failed');
  let navigateCalled = false;
  const feedback: unknown[] = [];

  const result = await openSaleTicketForOrder(order(), {
    async load() {
      return currentTicket();
    },
    async save() {
      throw failure;
    },
    navigate() {
      navigateCalled = true;
    },
    onError(error) {
      feedback.push(error);
    },
  });

  assert.equal(result, 'failed');
  assert.equal(navigateCalled, false);
  assert.deepEqual(feedback, [failure]);
});

test('openSaleTicketForOrder stays resolved when error feedback itself rejects', async () => {
  const result = await openSaleTicketForOrder(order(), {
    async load() {
      throw new Error('strict load failed');
    },
    async save() {},
    navigate() {},
    async onError() {
      throw new Error('feedback failed');
    },
  });

  assert.equal(result, 'failed');
});
