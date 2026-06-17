/**
 * insufficient_stock: el error del backend expone available_qty al vendedor.
 * Cubre: unwrapRestResult adjunta data+code; parser tolerante; describe.
 */
import assert from 'node:assert/strict';

interface StockMod {
  getInsufficientStockDetail: (error: unknown) => { lines: any[] } | null;
  describeInsufficientStock: (detail: { lines: any[] }) => string;
}
interface ApiResultMod {
  unwrapRestResult: (parsed: unknown, status: number) => unknown;
}

function runStock(m: StockMod) {
  // Error con code + data.lines → líneas con available_qty.
  const err: any = new Error('Stock insuficiente para 1 producto.');
  err.code = 'insufficient_stock';
  err.data = { error_code: 'insufficient_stock', lines: [
    { product_id: 7, product_name: 'Barra 5kg', requested_qty: 10, available_qty: 4 },
  ] };
  const detail = m.getInsufficientStockDetail(err);
  assert.ok(detail, 'debe detectar insufficient_stock');
  assert.equal(detail.lines.length, 1);
  assert.equal(detail.lines[0].availableQty, 4);
  assert.equal(detail.lines[0].requestedQty, 10);
  assert.match(m.describeInsufficientStock(detail), /Barra 5kg.*10.*4/);

  // Code sin líneas (endpoint aún sin desplegar el detalle) → {lines:[]} + texto genérico.
  const errNoLines: any = new Error('stock insuficiente');
  errNoLines.code = 'insufficient_stock';
  const d2 = m.getInsufficientStockDetail(errNoLines);
  assert.ok(d2 && d2.lines.length === 0);
  assert.match(m.describeInsufficientStock(d2), /stock insuficiente/i);

  // Detección por mensaje (fallback sin code).
  const byMsg: any = new Error('Insufficient stock for product');
  assert.ok(m.getInsufficientStockDetail(byMsg));

  // Otro error → null (no se confunde).
  const other: any = new Error('Empresas incompatibles'); other.code = 'company_mismatch';
  assert.equal(m.getInsufficientStockDetail(other), null);
  assert.equal(m.getInsufficientStockDetail(null), null);
  assert.equal(m.getInsufficientStockDetail('x'), null);
}

function runApiResult(m: ApiResultMod) {
  // ok:false con data → unwrapRestResult lanza con err.code y err.data.
  const envelope = { result: { ok: false, message: 'Stock insuficiente.', data: {
    error_code: 'insufficient_stock', lines: [{ product_id: 1, requested_qty: 3, available_qty: 0 }],
  } } };
  let thrown: any = null;
  try { m.unwrapRestResult(envelope, 200); } catch (e) { thrown = e; }
  assert.ok(thrown, 'debe lanzar en ok:false');
  assert.equal(thrown.code, 'insufficient_stock', 'code propagado (desde data.error_code)');
  assert.ok(thrown.data && Array.isArray(thrown.data.lines), 'data.lines propagado al error');
  assert.equal(thrown.data.lines[0].available_qty, 0);

  // ok:true → devuelve payload sin lanzar.
  assert.deepEqual(m.unwrapRestResult({ result: { ok: true, data: { x: 1 } } }, 200), { ok: true, data: { x: 1 } });
}

async function main() {
  const stock = await import(
    // @ts-ignore
    new URL('../src/services/insufficientStock.ts', import.meta.url).pathname
  ) as unknown as StockMod;
  const api = await import(
    // @ts-ignore
    new URL('../src/utils/apiResult.ts', import.meta.url).pathname
  ) as unknown as ApiResultMod;
  runStock(stock);
  runApiResult(api);
  console.log('insufficient stock tests: ok');
}
void main();
