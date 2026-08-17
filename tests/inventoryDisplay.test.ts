/**
 * Inventory display honesty: null/referential stock ≠ measured 0.
 */
import assert from 'node:assert/strict';

interface Mod {
  INVENTORY_SIN_DATO: string;
  formatAuthoritativeStockKg: (i: {
    hasStockData: boolean | null;
    totalStockKg: number;
  }) => string;
  formatForecastKg: (n: number) => string;
  shouldListProductOnInventory: (i: {
    hasStockData: boolean | null;
    qtyAvailable: number;
  }) => boolean;
  formatInventoryProductQty: (i: {
    hasStockData: boolean | null;
    qtyDisplay: number;
    totalKg: number;
    qtyReserved?: number;
  }) => string;
}

function run(m: Mod) {
  assert.equal(m.INVENTORY_SIN_DATO, 'Sin dato');

  assert.equal(
    m.formatAuthoritativeStockKg({ hasStockData: null, totalStockKg: 0 }),
    'Sin dato',
  );
  assert.equal(
    m.formatAuthoritativeStockKg({ hasStockData: false, totalStockKg: 50 }),
    'Sin dato',
  );
  assert.equal(
    m.formatAuthoritativeStockKg({ hasStockData: true, totalStockKg: 50 }),
    '50 kg',
  );
  assert.equal(
    m.formatAuthoritativeStockKg({ hasStockData: true, totalStockKg: Number.NaN }),
    'Sin dato',
  );

  assert.equal(m.formatForecastKg(0), 'Sin dato');
  assert.equal(m.formatForecastKg(-1), 'Sin dato');
  assert.equal(m.formatForecastKg(12), '12 kg');

  assert.equal(
    m.shouldListProductOnInventory({ hasStockData: true, qtyAvailable: 0 }),
    false,
  );
  assert.equal(
    m.shouldListProductOnInventory({ hasStockData: true, qtyAvailable: 2 }),
    true,
  );
  assert.equal(
    m.shouldListProductOnInventory({ hasStockData: false, qtyAvailable: 0 }),
    true,
  );
  assert.equal(
    m.shouldListProductOnInventory({ hasStockData: null, qtyAvailable: 0 }),
    true,
  );

  assert.equal(
    m.formatInventoryProductQty({
      hasStockData: false,
      qtyDisplay: 0,
      totalKg: 0,
    }),
    'Sin dato',
  );
  assert.equal(
    m.formatInventoryProductQty({
      hasStockData: true,
      qtyDisplay: 3,
      totalKg: 12.4,
      qtyReserved: 1,
    }),
    '3 disp. · 12kg · 1 res.',
  );

  console.log('inventoryDisplay tests: ok');
}

async function main() {
  const m = (await import(
    // @ts-ignore
    new URL('../src/services/inventoryDisplay.ts', import.meta.url).pathname
  )) as Mod;
  run(m);
}
void main();
