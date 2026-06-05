import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

const gfLogistics = readFileSync(
  resolve(REPO_ROOT, 'src/services/gfLogistics.ts'),
  'utf8',
);
const salesTab = readFileSync(
  resolve(REPO_ROOT, 'app/(tabs)/sales.tsx'),
  'utf8',
);
const routeTab = readFileSync(
  resolve(REPO_ROOT, 'app/(tabs)/route.tsx'),
  'utf8',
);
const homeTab = readFileSync(
  resolve(REPO_ROOT, 'app/(tabs)/index.tsx'),
  'utf8',
);
const analyticsScreen = readFileSync(
  resolve(REPO_ROOT, 'app/analytics.tsx'),
  'utf8',
);
const saleScreen = readFileSync(
  resolve(REPO_ROOT, 'app/sale/[stopId].tsx'),
  'utf8',
);

function main() {
  assert.match(
    gfLogistics,
    /sales\/summary/,
    'gfLogistics debe exponer el endpoint /sales/summary',
  );
  assert.match(
    gfLogistics,
    /sales\/list/,
    'gfLogistics debe exponer el endpoint /sales/list',
  );

  assert.doesNotMatch(
    salesTab,
    /const todaySales = 0;/,
    'la tab de ventas no debe seguir usando montos hardcodeados en 0',
  );
  assert.doesNotMatch(
    salesTab,
    /const todayOrders = 0;/,
    'la tab de ventas no debe seguir usando pedidos hardcodeados en 0',
  );
  assert.doesNotMatch(
    routeTab,
    /label: 'Vendido', value: '\$0'/,
    'la ruta no debe seguir pintando Vendido como $0 fijo',
  );
  assert.doesNotMatch(
    homeTab,
    /label="VENTA HOY"[\s\S]*value="\$0"/,
    'la home no debe seguir pintando VENTA HOY en $0 fijo',
  );
  assert.doesNotMatch(
    analyticsScreen,
    /label="VENTAS" value="\$0"/,
    'analytics no debe seguir pintando VENTAS en $0 fijo',
  );

  assert.match(
    saleScreen,
    /TextInput/,
    'la pantalla de venta debe permitir capturar directamente la cantidad de piezas',
  );
  assert.match(
    saleScreen,
    /keyboardType="number-pad"/,
    'el campo de piezas en venta debe abrir teclado numerico',
  );
  assert.match(
    saleScreen,
    /onChangeText=\{\(text\) => setSaleQtyFromText\(line\.productId, text\)\}/,
    'la cantidad capturada debe actualizar la linea de venta',
  );
  assert.match(
    salesTab,
    /TouchableOpacity/,
    'cada venta de la tab Ventas debe ser tocable para abrir su ticket PDF',
  );
  assert.match(
    salesTab,
    /openTicketForOrder/,
    'la tab Ventas debe tener un handler para abrir el ticket de una venta',
  );
  assert.match(
    salesTab,
    /buildSaleTicketSnapshotFromOrder/,
    'si no existe snapshot local, la tab Ventas debe crear un ticket imprimible desde la fila de venta',
  );
  assert.match(
    salesTab,
    /router\.push\(`\/print\/\$\{ticketId\}`/,
    'al tocar una venta debe navegar a la pantalla de PDF del ticket',
  );

  console.log('sales frontend wiring tests: ok');
}

main();
