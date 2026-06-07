/**
 * P1: método de pago de consignación + total a recuperar/devolver al cerrar.
 */
import assert from 'node:assert/strict';

interface Mod {
  CONSIGNMENT_PAYMENT_METHODS: ReadonlyArray<{ value: string; label: string }>;
  isValidConsignmentPaymentMethod: (m: unknown) => boolean;
  consignmentPaymentLabel: (m: string) => string;
  computeReturnTotal: (counts: ReadonlyArray<{ physical_qty: number }>) => number;
}

function run(m: Mod) {
  // MVP piloto: consignación sólo cobra efectivo hasta que corte soporte todos
  // los buckets de pago end-to-end.
  assert.deepEqual(
    m.CONSIGNMENT_PAYMENT_METHODS.map((x) => x.value),
    ['cash'],
  );

  assert.equal(m.isValidConsignmentPaymentMethod('cash'), true);
  assert.equal(m.isValidConsignmentPaymentMethod('transfer'), false);
  assert.equal(m.isValidConsignmentPaymentMethod('card'), false);
  assert.equal(m.isValidConsignmentPaymentMethod('credit'), false);
  assert.equal(m.isValidConsignmentPaymentMethod('paypal'), false);
  assert.equal(m.isValidConsignmentPaymentMethod(null), false);

  assert.equal(m.consignmentPaymentLabel('cash'), 'Efectivo');

  // total a devolver = suma de existencia física (clamp negativos)
  assert.equal(m.computeReturnTotal([{ physical_qty: 4 }, { physical_qty: 0 }, { physical_qty: 6 }]), 10);
  assert.equal(m.computeReturnTotal([{ physical_qty: -3 }, { physical_qty: 5 }]), 5);
  assert.equal(m.computeReturnTotal([]), 0);

  console.log('consignment payment tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/consignmentLogic.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
