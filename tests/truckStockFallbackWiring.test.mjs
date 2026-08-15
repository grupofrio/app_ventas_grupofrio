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
  const truckStockFunction = gfLogistics.slice(gfLogistics.indexOf('export async function fetchTruckStock'));
  assert.match(
    truckStockFunction,
    /throw new Error\('No fue posible cargar el inventario autorizado del camión\.'/,
    'un truck_stock ausente debe exponer error explícito y no habilitar un fallback legado',
  );
  assert.match(
    productStore,
    /loaded_truck_stock_reference/,
    'debe quedar log claro cuando truck_stock responde catalogo sin stock real',
  );

  console.log('truck stock fallback wiring tests: ok');
}

main();
