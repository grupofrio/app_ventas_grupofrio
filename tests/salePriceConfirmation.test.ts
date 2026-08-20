import assert from 'node:assert/strict';

interface SalePriceConfirmationModule {
  resolveSaleLinePrice: (input: {
    customerPrice: number | null;
    allowPendingPrice: boolean;
  }) => { price: number; priceConfirmation: 'authorized' | 'pending_confirmation' } | null;
}

async function main() {
  const mod = await import('../src/services/salePriceConfirmation.ts') as SalePriceConfirmationModule;

  assert.deepEqual(
    mod.resolveSaleLinePrice({ customerPrice: 18.5, allowPendingPrice: true }),
    { price: 18.5, priceConfirmation: 'authorized' },
  );
  assert.deepEqual(
    mod.resolveSaleLinePrice({ customerPrice: null, allowPendingPrice: true }),
    { price: 0, priceConfirmation: 'pending_confirmation' },
  );
  assert.equal(
    mod.resolveSaleLinePrice({ customerPrice: null, allowPendingPrice: false }),
    null,
  );
  console.log('sale price confirmation tests: ok');
}

void main();
