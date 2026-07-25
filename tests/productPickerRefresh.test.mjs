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
    /const refreshedProducts = useProductStore\.getState\(\)\.products[\s\S]*?loadOnlineCustomerPricing\(\{[\s\S]*?partnerId,[\s\S]*?products:\s*refreshedProducts/,
    'ProductPicker debe recalcular el full response con los productos recien cargados',
  );
  assert.match(
    productPicker,
    /products:\s*refreshedProducts,[\s\S]*?forceFullResponse:\s*true/,
    'refresh manual debe forzar un full response nuevo aunque el contexto no cambie',
  );
  assert.match(
    productPicker,
    /return inFlightFullCustomerPricing\.run\([\s\S]*?force:\s*input\.force/,
    'el loader local debe pasar force al dedupe sin cambiar el transporte compartido',
  );
  assert.match(
    productPicker,
    /Refrescar/,
    'ProductPicker debe exponer un boton visible de Refrescar dentro del modal',
  );

  console.log('product picker refresh tests: ok');
}

main();
