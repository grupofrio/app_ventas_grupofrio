import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const productStore = readFileSync(
    resolve(REPO_ROOT, 'src/stores/useProductStore.ts'),
    'utf8',
  );
  const gfLogistics = readFileSync(
    resolve(REPO_ROOT, 'src/services/gfLogistics.ts'),
    'utf8',
  );

  assert.match(productStore, /scoped\.products/, 'truck_stock debe ser la única fuente de catálogo fresco');
  assert.doesNotMatch(
    productStore,
    /\bodooRead\b|stock\.quant|product\.product|global_legacy|stock_quant/,
    'el catálogo no debe caer a stock.quant, product.product ni catálogo global',
  );
  assert.match(
    gfLogistics,
    /parseTruckStockResponse\(result\)/,
    'truck_stock debe validar el sobre antes de devolverlo al store',
  );
  assert.match(
    productStore,
    /loaded_truck_stock_reference/,
    'debe quedar log claro cuando truck_stock responde catalogo sin stock real',
  );

  console.log('truck stock fallback wiring tests: ok');
}

main();
