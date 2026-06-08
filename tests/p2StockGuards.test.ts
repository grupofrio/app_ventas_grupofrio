/**
 * P2: control de stock en regalo y consignación-create reusando el validador
 * de stock fresco (P0) — sin duplicar lógica. Aquí se prueba la composición.
 */
import assert from 'node:assert/strict';

interface GiftMod {
  toGiftPayloadLines: (lines: Array<{ key: string; productId: number | null; qtyText: string }>) =>
    Array<{ productId: number; qty: number }>;
}
interface StockMod {
  findFreshStockIssues: (
    lines: Array<{ productId: number; productName: string; qty: number }>,
    products: Array<{ id: number; qty_display?: number }>,
    options?: { requireKnownProduct?: boolean },
  ) => Array<{ productId: number; kind: string; requested: number; available: number }>;
}

function runGiftInvalidQty(gift: GiftMod) {
  // Regalo inválido: qty<=0, NaN, vacía → se descartan (no generan línea).
  assert.deepEqual(gift.toGiftPayloadLines([{ key: 'a', productId: 10, qtyText: '0' }]), []);
  assert.deepEqual(gift.toGiftPayloadLines([{ key: 'a', productId: 10, qtyText: '-3' }]), []);
  assert.deepEqual(gift.toGiftPayloadLines([{ key: 'a', productId: 10, qtyText: 'abc' }]), []);
  assert.deepEqual(gift.toGiftPayloadLines([{ key: 'a', productId: 10, qtyText: '' }]), []);
  // Válida
  assert.deepEqual(gift.toGiftPayloadLines([{ key: 'a', productId: 10, qtyText: '3' }]), [{ productId: 10, qty: 3 }]);
}

function runGiftOverStock(stock: StockMod) {
  const products = [{ id: 10, qty_display: 5 }, { id: 20, qty_display: 0 }];
  // Regalo > stock → over_stock
  const over = stock.findFreshStockIssues([{ productId: 10, productName: 'Bolsa', qty: 6 }], products);
  assert.equal(over.length, 1);
  assert.equal(over[0].kind, 'over_stock');
  assert.equal(over[0].available, 5);
  // Regalo dentro de stock → ok
  assert.equal(stock.findFreshStockIssues([{ productId: 10, productName: 'Bolsa', qty: 5 }], products).length, 0);
  // Producto sin stock → cualquier qty positiva es over_stock
  assert.equal(stock.findFreshStockIssues([{ productId: 20, productName: 'X', qty: 1 }], products)[0].kind, 'over_stock');
}

function runConsignmentCreateOverStock(stock: StockMod) {
  // Consignación CREATE: el carrito es {productId, productName, qty=objetivo}.
  const products = [{ id: 10, qty_display: 8 }];
  const cart = [{ productId: 10, productName: 'Bolsa 5kg', qty: 12 }]; // objetivo 12 > 8
  const issues = stock.findFreshStockIssues(cart, products);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'over_stock');
  assert.equal(issues[0].available, 8);
  // Objetivo <= disponible → ok
  assert.equal(stock.findFreshStockIssues([{ productId: 10, productName: 'Bolsa 5kg', qty: 8 }], products).length, 0);
}

async function main() {
  const gift = await import(
    // @ts-ignore
    new URL('../src/services/giftPayload.ts', import.meta.url).pathname
  ) as GiftMod;
  const stock = await import(
    // @ts-ignore
    new URL('../src/services/saleStockValidation.ts', import.meta.url).pathname
  ) as StockMod;

  runGiftInvalidQty(gift);
  runGiftOverStock(stock);
  runConsignmentCreateOverStock(stock);
  console.log('p2 stock guards tests: ok');
}
void main();
