/**
 * Tests for presaleLogic — Preventa pure helpers.
 * cart→lines, total, delivery-date validation, addDays, payload build/guards.
 */

import assert from 'node:assert/strict';
import type { SaleLineItem } from '../src/stores/useVisitStore';

interface PresaleLogicModule {
  cartToPresaleLines: (cart: SaleLineItem[]) => Array<{ product_id: number; quantity: number; price_unit: number }>;
  computeCartTotal: (cart: SaleLineItem[]) => number;
  validateDeliveryDate: (date: string, todayIso: string) => string | null;
  addDaysIso: (baseIso: string, days: number) => string;
  buildPresalePayload: (
    input: {
      operationId: string; partnerId: number | null; leadId: number | null;
      commitmentDate: string; cart: SaleLineItem[]; employeeId: number | null;
      companyId: number | null; routePlanId: number | null;
    },
    opts: { todayIso: string; allowLead: boolean },
  ) => { ok: true; payload: any } | { ok: false; reason: string };
}

function line(partial: Partial<SaleLineItem> & Pick<SaleLineItem, 'productId' | 'qty' | 'price'>): SaleLineItem {
  return {
    productId: partial.productId,
    productName: partial.productName ?? `P${partial.productId}`,
    price: partial.price,
    qty: partial.qty,
    stock: partial.stock ?? 999,
    weight: partial.weight ?? 5,
  };
}

function testCartToLines(m: PresaleLogicModule) {
  const cart = [line({ productId: 10, qty: 5, price: 25 }), line({ productId: 0, qty: 1, price: 1 }), line({ productId: 11, qty: 0, price: 9 })];
  assert.deepEqual(m.cartToPresaleLines(cart), [{ product_id: 10, quantity: 5, price_unit: 25 }]);
}

function testTotal(m: PresaleLogicModule) {
  assert.equal(m.computeCartTotal([line({ productId: 1, qty: 2, price: 10 }), line({ productId: 2, qty: 3, price: 5 })]), 35);
  assert.equal(m.computeCartTotal([]), 0);
}

function testValidateDate(m: PresaleLogicModule) {
  const today = '2026-06-10';
  assert.equal(m.validateDeliveryDate('2026-06-15', today), null);
  assert.equal(m.validateDeliveryDate('2026-06-10', today), null); // today is allowed
  assert.ok(m.validateDeliveryDate('2026-06-09', today)); // past → reason
  assert.ok(m.validateDeliveryDate('', today));
  assert.ok(m.validateDeliveryDate('15-06-2026', today)); // wrong format
  assert.ok(m.validateDeliveryDate('2026-13-40', today)); // impossible
}

function testAddDays(m: PresaleLogicModule) {
  assert.equal(m.addDaysIso('2026-06-10', 1), '2026-06-11');
  assert.equal(m.addDaysIso('2026-06-30', 1), '2026-07-01'); // month rollover
  assert.equal(m.addDaysIso('2026-12-31', 1), '2027-01-01'); // year rollover
  assert.equal(m.addDaysIso('2026-06-10', 7), '2026-06-17');
}

function testBuildPayload(m: PresaleLogicModule) {
  const today = '2026-06-10';
  const base = {
    operationId: 'op-1', partnerId: 123, leadId: null,
    commitmentDate: '2026-06-15', cart: [line({ productId: 10, qty: 5, price: 25 })],
    employeeId: 45, companyId: 1, routePlanId: 987,
  };
  const ok = m.buildPresalePayload(base, { todayIso: today, allowLead: false });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.payload.partner_id, 123);
    assert.equal(ok.payload.commitment_date, '2026-06-15');
    assert.equal(ok.payload.source, 'koldfield_presale');
    assert.deepEqual(ok.payload.lines, [{ product_id: 10, quantity: 5, price_unit: 25 }]);
  }

  // no client → fail
  assert.equal(m.buildPresalePayload({ ...base, partnerId: null, leadId: null }, { todayIso: today, allowLead: false }).ok, false);
  // lead not allowed → fail with conversion message
  const leadBlocked = m.buildPresalePayload({ ...base, partnerId: null, leadId: 77 }, { todayIso: today, allowLead: false });
  assert.equal(leadBlocked.ok, false);
  if (!leadBlocked.ok) assert.match(leadBlocked.reason, /convertirse a cliente/i);
  // lead allowed → ok
  assert.equal(m.buildPresalePayload({ ...base, partnerId: null, leadId: 77 }, { todayIso: today, allowLead: true }).ok, true);
  // empty cart → fail
  assert.equal(m.buildPresalePayload({ ...base, cart: [] }, { todayIso: today, allowLead: false }).ok, false);
  // past date → fail
  assert.equal(m.buildPresalePayload({ ...base, commitmentDate: '2026-06-01' }, { todayIso: today, allowLead: false }).ok, false);
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/presaleLogic.ts', import.meta.url).pathname
  ) as PresaleLogicModule;

  testCartToLines(m);
  testTotal(m);
  testValidateDate(m);
  testAddDays(m);
  testBuildPayload(m);

  console.log('presale logic tests: ok');
}

void main();
