/**
 * Tests for consignmentLogic — Consignación pure helpers.
 * Regla: vendido = max(0, objetivo - físico); resurtido = vendido;
 *        importe = vendido * precio.
 */

import assert from 'node:assert/strict';
import type { ConsignmentLine } from '../src/types/consignment';
import type { SaleLineItem } from '../src/stores/useVisitStore';

interface LogicModule {
  computeLineCalc: (line: ConsignmentLine, physicalQty: number) => {
    sold_qty: number; restock_qty: number; charge_amount: number; target_qty: number; physical_qty: number;
  };
  computeVisitTotals: (calcs: any[]) => { soldTotal: number; chargeTotal: number; restockTotal: number };
  computeConsignedValue: (lines: Array<{ product_id: number; target_qty: number; price_unit: number }>) => number;
  cartToCreateLines: (cart: SaleLineItem[]) => Array<{ product_id: number; target_qty: number; price_unit: number }>;
  validateCreateLines: (cart: SaleLineItem[]) => { ok: true; lines: any[] } | { ok: false; reason: string };
  buildPhysicalLines: (lines: ConsignmentLine[], input: Record<number, string>) =>
    { ok: true; lines: Array<{ product_id: number; physical_qty: number }> } | { ok: false; reason: string };
}

function cline(partial: Partial<ConsignmentLine> & Pick<ConsignmentLine, 'product_id' | 'target_qty' | 'price_unit'>): ConsignmentLine {
  return {
    product_id: partial.product_id,
    product_name: partial.product_name ?? `P${partial.product_id}`,
    target_qty: partial.target_qty,
    theoretical_qty: partial.theoretical_qty ?? partial.target_qty,
    price_unit: partial.price_unit,
    last_visit: null,
  };
}
function sline(productId: number, qty: number, price: number): SaleLineItem {
  return { productId, productName: `P${productId}`, price, qty, stock: 999, weight: 5 };
}

function testLineCalc(m: LogicModule) {
  // objetivo 10, físico 4 → vendido 6, resurtir 6, cobro 6*25=150
  const c = m.computeLineCalc(cline({ product_id: 10, target_qty: 10, price_unit: 25 }), 4);
  assert.equal(c.sold_qty, 6);
  assert.equal(c.restock_qty, 6);
  assert.equal(c.charge_amount, 150);
  // físico >= objetivo → vendido 0 (sin negativos)
  assert.equal(m.computeLineCalc(cline({ product_id: 1, target_qty: 10, price_unit: 5 }), 12).sold_qty, 0);
  assert.equal(m.computeLineCalc(cline({ product_id: 1, target_qty: 10, price_unit: 5 }), 10).sold_qty, 0);
  // físico negativo → tratado como 0 → vendido = objetivo
  assert.equal(m.computeLineCalc(cline({ product_id: 1, target_qty: 8, price_unit: 1 }), -3).sold_qty, 8);
}

function testVisitTotals(m: LogicModule) {
  const calcs = [
    m.computeLineCalc(cline({ product_id: 1, target_qty: 10, price_unit: 25 }), 4), // sold6 charge150
    m.computeLineCalc(cline({ product_id: 2, target_qty: 5, price_unit: 10 }), 3),  // sold2 charge20
  ];
  const t = m.computeVisitTotals(calcs);
  assert.equal(t.soldTotal, 8);
  assert.equal(t.chargeTotal, 170);
  assert.equal(t.restockTotal, 8);
}

function testConsignedValue(m: LogicModule) {
  assert.equal(m.computeConsignedValue([
    { product_id: 1, target_qty: 10, price_unit: 25 },
    { product_id: 2, target_qty: 4, price_unit: 5 },
  ]), 270);
}

function testCreateValidation(m: LogicModule) {
  assert.equal(m.validateCreateLines([]).ok, false);
  assert.equal(m.validateCreateLines([sline(0, 5, 10)]).ok, false); // invalid product
  const ok = m.validateCreateLines([sline(10, 5, 25)]);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.lines, [{ product_id: 10, target_qty: 5, price_unit: 25 }]);
}

function testPhysicalLines(m: LogicModule) {
  const lines = [cline({ product_id: 1, target_qty: 10, price_unit: 5 }), cline({ product_id: 2, target_qty: 5, price_unit: 3 })];
  // missing one → fail
  assert.equal(m.buildPhysicalLines(lines, { 1: '4' }).ok, false);
  // empty string → fail (must capture)
  assert.equal(m.buildPhysicalLines(lines, { 1: '4', 2: '' }).ok, false);
  // invalid → fail
  assert.equal(m.buildPhysicalLines(lines, { 1: '4', 2: 'abc' }).ok, false);
  assert.equal(m.buildPhysicalLines(lines, { 1: '4', 2: '-1' }).ok, false);
  // all valid → ok (0 allowed)
  const ok = m.buildPhysicalLines(lines, { 1: '4', 2: '0' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.lines, [{ product_id: 1, physical_qty: 4 }, { product_id: 2, physical_qty: 0 }]);
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/consignmentLogic.ts', import.meta.url).pathname
  ) as LogicModule;

  testLineCalc(m);
  testVisitTotals(m);
  testConsignedValue(m);
  testCreateValidation(m);
  testPhysicalLines(m);

  console.log('consignment logic tests: ok');
}

void main();
