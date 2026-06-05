import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const productPicker = readFileSync(
  resolve(REPO_ROOT, 'src/components/domain/ProductPicker.tsx'),
  'utf8',
);

function main() {
  assert.match(
    productPicker,
    /useAuthStore\(\(s\) => s\.warehouseId\)/,
    'ProductPicker debe leer warehouseId para refrescar inventario desde el modal',
  );
  assert.match(
    productPicker,
    /clearPricelistCaches\(\)/,
    'ProductPicker debe limpiar caches de lista de precio al refrescar',
  );
  assert.match(
    productPicker,
    /await loadProducts\(warehouseId\)/,
    'ProductPicker debe recargar inventario del camion al refrescar',
  );
  assert.match(
    productPicker,
    /computeCustomerPrices\(partnerId, useProductStore\.getState\(\)\.products/,
    'ProductPicker debe recalcular precios con los productos recien cargados',
  );
  assert.match(
    productPicker,
    /Refrescar/,
    'ProductPicker debe exponer un boton visible de Refrescar dentro del modal',
  );

  console.log('product picker refresh tests: ok');
}

main();
