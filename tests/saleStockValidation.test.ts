/**
 * P0-1 (frontend-safe): revalidación de carrito contra stock fresco al confirmar.
 */
import assert from 'node:assert/strict';

interface Mod {
  findFreshStockIssues: (
    lines: Array<{ productId: number; productName: string; qty: number }>,
    products: Array<{ id: number; qty_display?: number }>,
    options?: { requireKnownProduct?: boolean },
  ) => Array<{ productId: number; kind: string; requested: number; available: number }>;
}

function run(m: Mod) {
  const products = [
    { id: 10, qty_display: 5 },
    { id: 20, qty_display: 0 },
    { id: 30, qty_display: 100 },
  ];

  // OK: qty <= fresh stock
  assert.equal(m.findFreshStockIssues([{ productId: 10, productName: 'A', qty: 5 }], products).length, 0);

  // over_stock: qty > fresh stock (stale cart cap)
  const over = m.findFreshStockIssues([{ productId: 10, productName: 'A', qty: 6 }], products);
  assert.equal(over.length, 1);
  assert.equal(over[0].kind, 'over_stock');
  assert.equal(over[0].available, 5);

  // invalid_qty: 0 / negative / NaN
  assert.equal(m.findFreshStockIssues([{ productId: 30, productName: 'C', qty: 0 }], products)[0].kind, 'invalid_qty');
  assert.equal(m.findFreshStockIssues([{ productId: 30, productName: 'C', qty: -2 }], products)[0].kind, 'invalid_qty');
  assert.equal(m.findFreshStockIssues([{ productId: 30, productName: 'C', qty: NaN }], products)[0].kind, 'invalid_qty');

  // qty_display 0 → selling any positive qty is over_stock
  assert.equal(m.findFreshStockIssues([{ productId: 20, productName: 'B', qty: 1 }], products)[0].kind, 'over_stock');

  // unknown product: default does NOT block (backend is source of truth)
  assert.equal(m.findFreshStockIssues([{ productId: 99, productName: 'Z', qty: 1 }], products).length, 0);
  // ...unless requireKnownProduct
  const strict = m.findFreshStockIssues([{ productId: 99, productName: 'Z', qty: 1 }], products, { requireKnownProduct: true });
  assert.equal(strict[0].kind, 'unknown_product');

  console.log('sale stock validation tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/saleStockValidation.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
