import assert from 'node:assert/strict';
import { formatInventoryKg } from '../src/services/inventoryDisplay.ts';

function main() {
  assert.equal(
    formatInventoryKg({ hasStockData: false, quantityKg: 0 }),
    'Sin dato',
    'sin stock autoritativo no debe presentarse como cero',
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

  console.log('inventory honesty tests: ok');
}

main();
