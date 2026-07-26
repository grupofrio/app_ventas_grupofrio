import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const gfLogistics = readFileSync(resolve(REPO_ROOT, 'src/services/gfLogistics.ts'), 'utf8');
  const salesScreen = readFileSync(resolve(REPO_ROOT, 'app/(tabs)/sales.tsx'), 'utf8');
  const saleTicketOpen = readFileSync(
    resolve(REPO_ROOT, 'src/services/saleTicketOpen.ts'),
    'utf8',
  );

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
  assert.match(
    saleTicketOpen,
    /buildSaleTicketSnapshotFromOrder\(order\)/,
    'El flujo de apertura debe convertir las lineas definitivas de /sales/list en el ticket remoto',
  );
  assert.match(
    saleTicketOpen,
    /mergeSaleTicketFromOrder\(current, order\)[\s\S]*?await dependencies\.save\(merged\)[\s\S]*?await dependencies\.navigate\(merged\.saleId\)/,
    'El flujo debe combinar y guardar las lineas remotas antes de imprimir',
  );
  assert.match(
    salesScreen,
    /save:\s*saveSaleTicketSnapshot/,
    'Ventas debe inyectar el guardado durable al flujo de apertura',
  );
  assert.doesNotMatch(
    salesScreen,
    /CustomerPricingSnapshot|customerPricingSnapshot|CUSTOMER_PRICING_SNAPSHOTS/,
    'Abrir una venta remota no debe inferir ni escribir snapshots de precios de cliente',
  );

  console.log('sales list lines wiring tests: ok');
}

main();
