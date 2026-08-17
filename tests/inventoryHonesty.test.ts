import assert from 'node:assert/strict';
import {
  formatInventoryKg,
  getInventoryProductListState,
} from '../src/services/inventoryDisplay.ts';

function main() {
  assert.equal(
    formatInventoryKg({ hasStockData: false, quantityKg: 0 }),
    'Sin dato',
    'sin stock autoritativo no debe presentarse como cero',
  );
  assert.equal(
    formatInventoryKg({ hasStockData: null, quantityKg: 8 }),
    'Sin dato',
    'un snapshot ausente también debe seguir la semántica de dato desconocido',
  );
  assert.equal(
    formatInventoryKg({ hasStockData: true, quantityKg: 0 }),
    '0 kg',
    'cero confirmado debe seguir siendo un valor explícito',
  );
  assert.equal(
    formatInventoryKg({ hasStockData: true, quantityKg: 17 }),
    '17 kg',
    'stock confirmado positivo debe conservar su cantidad',
  );
  assert.deepEqual(
    getInventoryProductListState({ hasStockData: null, visibleProductCount: 3 }),
    {
      kind: 'unknown',
      title: 'Sin dato',
      detail: 'Aún no hay inventario confirmado de tu unidad.',
    },
    'la lista no debe caer al estado vacío cuando el stock de unidad es desconocido',
  );

  console.log('inventory honesty tests: ok');
}

main();
