import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const gfLogistics = readFileSync(resolve(REPO_ROOT, 'src/services/gfLogistics.ts'), 'utf8');

  assert.match(
    gfLogistics,
    /interface GFSalesOrderLine/,
    'gfLogistics debe tipar las lineas de orden recibidas por /sales/list',
  );
  assert.match(
    gfLogistics,
    /lines:\s*GFSalesOrderLine\[\]/,
    'GFSalesOrder debe exponer lines para que el ticket PDF pueda imprimir productos',
  );
  assert.match(
    gfLogistics,
    /const linesRaw = Array\.isArray\(order\.lines\)/,
    'normalizeSalesList debe leer order.lines cuando el backend las devuelve',
  );
  assert.match(
    gfLogistics,
    /product_name/,
    'normalizeSalesList debe conservar el nombre de producto de cada linea',
  );
  assert.match(
    gfLogistics,
    /price_subtotal/,
    'normalizeSalesList debe conservar el subtotal de cada linea',
  );
  assert.match(
    gfLogistics,
    /payment_method:\s*typeof order\.payment_method === 'string'/,
    'normalizeSalesList debe conservar payment_method para imprimirlo en el ticket',
  );
  assert.match(
    gfLogistics,
    /payment_method_label:\s*typeof order\.payment_method_label === 'string'/,
    'normalizeSalesList debe conservar payment_method_label cuando el backend lo envia',
  );
  assert.match(
    gfLogistics,
    /employee_name:\s*typeof order\.employee_name === 'string'/,
    'normalizeSalesList debe conservar employee_name para imprimir vendedor en el ticket',
  );

  console.log('sales list lines wiring tests: ok');
}

main();
