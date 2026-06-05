import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const productStore = readFileSync(
    resolve(REPO_ROOT, 'src/stores/useProductStore.ts'),
    'utf8',
  );

  assert.match(
    productStore,
    /scoped && scoped\.products\.length > 0\) \{/,
    'truck_stock con productos debe poblar el store aunque hasStockData=false',
  );
  assert.doesNotMatch(
    productStore,
    /scoped\.hasStockData !== false/,
    'hasStockData=false no debe descartar el catalogo REST ni forzar get_records',
  );
  assert.match(
    productStore,
    /\['location_id', 'child_of', mobileLocationId\]/,
    'stock.quant debe consultar por la ubicacion movil y sus sububicaciones',
  );
  assert.match(
    productStore,
    /loaded_truck_stock_reference/,
    'debe quedar log claro cuando truck_stock responde catalogo sin stock real',
  );

  console.log('truck stock fallback wiring tests: ok');
}

main();
