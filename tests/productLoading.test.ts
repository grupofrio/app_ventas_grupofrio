import assert from 'node:assert/strict';

function testAutoloadWhenWarehousePresentAndStoreEmpty(
  shouldAutoLoadProducts: (warehouseId: number | null | undefined, productCount: number, isLoading: boolean) => boolean,
) {
  assert.equal(shouldAutoLoadProducts(12, 0, false), true);
}

function testSkipsAutoloadWithoutWarehouse(
  shouldAutoLoadProducts: (warehouseId: number | null | undefined, productCount: number, isLoading: boolean) => boolean,
) {
  assert.equal(shouldAutoLoadProducts(null, 0, false), false);
  assert.equal(shouldAutoLoadProducts(0, 0, false), false);
}

function testSkipsAutoloadWhenAlreadyLoadedOrLoading(
  shouldAutoLoadProducts: (
    warehouseId: number | null | undefined,
    productCount: number,
    isLoading: boolean,
    lastSyncMs?: number | null,
    error?: string | null,
  ) => boolean,
) {
  assert.equal(shouldAutoLoadProducts(12, 4, false), false);
  assert.equal(shouldAutoLoadProducts(12, 0, true), false);
}

function testSkipsAutoloadAfterAttemptOrError(
  shouldAutoLoadProducts: (
    warehouseId: number | null | undefined,
    productCount: number,
    isLoading: boolean,
    lastSyncMs?: number | null,
    error?: string | null,
  ) => boolean,
) {
  assert.equal(shouldAutoLoadProducts(12, 0, false, Date.now() - 10_000, null), false);
  assert.equal(shouldAutoLoadProducts(12, 0, false, null, 'Dominio no autorizado.'), false);
}

type RefreshOnFocusFn = (
  warehouseId: number | null | undefined,
  isLoading: boolean,
  productCount?: number,
  lastSyncMs?: number | null,
) => boolean;

function testRefreshesOnFocusWhenWarehousePresentAndIdle(
  shouldRefreshProductsOnFocus: RefreshOnFocusFn,
) {
  // Caché vacía → refresca
  assert.equal(shouldRefreshProductsOnFocus(12, false, 0, null), true);
  // Caché con data RANCIA (>5min) → refresca
  assert.equal(shouldRefreshProductsOnFocus(12, false, 14, Date.now() - 10 * 60 * 1000), true);
}

function testSkipsFocusRefreshWithoutWarehouseOrWhileLoading(
  shouldRefreshProductsOnFocus: RefreshOnFocusFn,
) {
  assert.equal(shouldRefreshProductsOnFocus(null, false, 0, null), false);
  assert.equal(shouldRefreshProductsOnFocus(0, false, 0, null), false);
  assert.equal(shouldRefreshProductsOnFocus(12, true, 0, null), false);
}

// BLD-20260424-LOOP: el test que rompe el loop. Caché poblada y reciente
// NO debe refrescarse aunque el caller invoque la función múltiples veces.
function testDoesNotRefreshWhenCacheIsFreshAndPopulated(
  shouldRefreshProductsOnFocus: RefreshOnFocusFn,
) {
  // Caché con 14 productos sincronizados hace 10 segundos → NO refresca
  assert.equal(shouldRefreshProductsOnFocus(12, false, 14, Date.now() - 10_000), false);
  // Caché con 14 productos sin lastSync explícito → tampoco refresca
  assert.equal(shouldRefreshProductsOnFocus(12, false, 14, null), false);
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const productLoading = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/utils/productLoading.ts', import.meta.url).pathname
  );

  testAutoloadWhenWarehousePresentAndStoreEmpty(productLoading.shouldAutoLoadProducts);
  testSkipsAutoloadWithoutWarehouse(productLoading.shouldAutoLoadProducts);
  testSkipsAutoloadWhenAlreadyLoadedOrLoading(productLoading.shouldAutoLoadProducts);
  testSkipsAutoloadAfterAttemptOrError(productLoading.shouldAutoLoadProducts);
  testRefreshesOnFocusWhenWarehousePresentAndIdle(productLoading.shouldRefreshProductsOnFocus);
  testSkipsFocusRefreshWithoutWarehouseOrWhileLoading(productLoading.shouldRefreshProductsOnFocus);
  testDoesNotRefreshWhenCacheIsFreshAndPopulated(productLoading.shouldRefreshProductsOnFocus);
  console.log('product loading tests: ok');
}

void main();
