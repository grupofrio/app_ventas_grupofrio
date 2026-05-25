import assert from 'node:assert/strict';

interface OffroutePricingModule {
  warmOffrouteCustomerPrices: (
    result: {
      id: number;
      entityType: 'customer' | 'lead';
      partnerId: number | null;
      pricelistId: number | null;
    },
    context: {
      companyId?: number | null;
      warehouseId?: number | null;
    },
    deps: {
      getProducts: () => Array<{ id: number; list_price: number }>;
      loadProducts: (warehouseId: number) => Promise<void>;
      computeCustomerPrices: (
        partnerId: number,
        products: Array<{ id: number; list_price: number }>,
        options?: { companyId?: number | null; fallbackPricelistId?: number | null },
      ) => Promise<Map<number, number>>;
    },
  ) => Promise<{ status: 'warmed' | 'skipped' | 'failed'; reason?: string }>;
}

async function testWarmsCustomerPricesAfterLoadingProducts(module: OffroutePricingModule) {
  let products: Array<{ id: number; list_price: number }> = [];
  const loadCalls: number[] = [];
  const computeCalls: Array<{
    partnerId: number;
    products: Array<{ id: number; list_price: number }>;
    options?: { companyId?: number | null; fallbackPricelistId?: number | null };
  }> = [];

  const result = await module.warmOffrouteCustomerPrices(
    {
      id: 55251,
      entityType: 'customer',
      partnerId: 55251,
      pricelistId: 90,
    },
    { companyId: 34, warehouseId: 113 },
    {
      getProducts: () => products,
      loadProducts: async (warehouseId) => {
        loadCalls.push(warehouseId);
        products = [{ id: 10, list_price: 44 }];
      },
      computeCustomerPrices: async (partnerId, pricedProducts, options) => {
        computeCalls.push({ partnerId, products: pricedProducts, options });
        return new Map([[10, 40]]);
      },
    },
  );

  assert.deepEqual(result, { status: 'warmed' });
  assert.deepEqual(loadCalls, [113]);
  assert.equal(computeCalls.length, 1);
  assert.equal(computeCalls[0].partnerId, 55251);
  assert.deepEqual(computeCalls[0].products, [{ id: 10, list_price: 44 }]);
  assert.deepEqual(computeCalls[0].options, {
    companyId: 34,
    fallbackPricelistId: 90,
  });
}

async function testSkipsLeadsWithoutPartner(module: OffroutePricingModule) {
  let computeCalled = false;

  const result = await module.warmOffrouteCustomerPrices(
    {
      id: 22,
      entityType: 'lead',
      partnerId: null,
      pricelistId: null,
    },
    { companyId: 34, warehouseId: 113 },
    {
      getProducts: () => [{ id: 10, list_price: 44 }],
      loadProducts: async () => {
        throw new Error('should not load without partner');
      },
      computeCustomerPrices: async () => {
        computeCalled = true;
        return new Map();
      },
    },
  );

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'missing_partner');
  assert.equal(computeCalled, false);
}

async function main() {
  const module = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/offroutePricing.ts', import.meta.url).pathname
  ) as OffroutePricingModule;

  await testWarmsCustomerPricesAfterLoadingProducts(module);
  await testSkipsLeadsWithoutPartner(module);
  console.log('offroute pricing tests: ok');
}

void main();
