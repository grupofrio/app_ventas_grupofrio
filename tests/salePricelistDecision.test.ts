import assert from 'node:assert/strict';

interface SalePricelistDecisionModule {
  decideSalePricelist: (input: {
    isOnline: boolean;
    stopPricelistId: number | null;
    cachedPricelistId: number | null;
  }) => {
    pricelistId: number | null;
    shouldResolvePartnerPricelist: boolean;
  };
}

function run(module: SalePricelistDecisionModule) {
  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: false,
      stopPricelistId: 81,
      cachedPricelistId: 90,
    }),
    { pricelistId: 81, shouldResolvePartnerPricelist: false },
  );

  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: true,
      stopPricelistId: 81,
      cachedPricelistId: null,
    }),
    { pricelistId: 81, shouldResolvePartnerPricelist: false },
  );

  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: false,
      stopPricelistId: null,
      cachedPricelistId: 90,
    }),
    { pricelistId: 90, shouldResolvePartnerPricelist: false },
  );

  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: false,
      stopPricelistId: null,
      cachedPricelistId: null,
    }),
    { pricelistId: null, shouldResolvePartnerPricelist: false },
  );

  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: true,
      stopPricelistId: null,
      cachedPricelistId: 90,
    }),
    { pricelistId: 90, shouldResolvePartnerPricelist: true },
  );

  assert.deepEqual(
    module.decideSalePricelist({
      isOnline: true,
      stopPricelistId: null,
      cachedPricelistId: null,
    }),
    { pricelistId: null, shouldResolvePartnerPricelist: true },
  );

  for (const invalidId of [0, -1, Number.NaN]) {
    assert.deepEqual(
      module.decideSalePricelist({
        isOnline: false,
        stopPricelistId: invalidId,
        cachedPricelistId: invalidId,
      }),
      { pricelistId: null, shouldResolvePartnerPricelist: false },
    );
  }
}

async function main() {
  const module = await import(
    // @ts-ignore -- Node executes this TypeScript module directly in the test runner.
    new URL('../src/services/salePricelistDecision.ts', import.meta.url).pathname
  ) as SalePricelistDecisionModule;

  run(module);
  console.log('sale pricelist decision tests: ok');
}

void main();
