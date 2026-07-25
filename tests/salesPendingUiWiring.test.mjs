import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const salesScreen = readFileSync(
  resolve(process.cwd(), 'app/(tabs)/sales.tsx'),
  'utf8',
);

assert.match(
  salesScreen,
  /useSalesListProjection\(\)/,
  'Ventas debe usar la proyección unificada para no ocultar ventas locales',
);
assert.match(
  salesScreen,
  /entries[\s\S]*localSummary[\s\S]*ticketsLoading/,
  'Ventas debe consumir entradas, resumen local y carga de tickets del hook',
);
assert.match(
  salesScreen,
  /useSalesStore\(\(s\)\s*=>\s*s\.summary\)/,
  'los KPI oficiales deben conservar el summary de Odoo como única fuente',
);
assert.match(
  salesScreen,
  /const todaySales\s*=\s*summary\.sales_amount_total/,
  'VENDIDO no debe sumar ventas locales pendientes',
);
assert.match(
  salesScreen,
  /const todayKg\s*=\s*summary\.kg_total/,
  'KG no debe sumar ventas locales pendientes',
);
assert.match(
  salesScreen,
  /const todayOrders\s*=\s*summary\.orders_count/,
  'PEDIDOS no debe sumar ventas locales pendientes',
);
assert.match(
  salesScreen,
  /VENTAS PENDIENTES/,
  'el resumen local debe vivir en una tarjeta separada de los KPI oficiales',
);
for (const field of [
  'localSummary.count',
  'localSummary.knownAmountTotal',
  'localSummary.unknownAmountCount',
  'localSummary.needsAttentionCount',
]) {
  assert.match(
    salesScreen,
    new RegExp(field.replace('.', '\\.')),
    `la tarjeta pendiente debe explicar ${field}`,
  );
}
assert.match(
  salesScreen,
  /localSummary\.unknownAmountCount\s*>\s*0[\s\S]*Monto conocido/,
  'un total parcial debe etiquetarse como monto conocido, no como total definitivo',
);
assert.match(
  salesScreen,
  /entry\.amountTotal\s*===\s*null[\s\S]*(?:Monto pendiente|Por confirmar)/,
  'una venta sin monto conocido nunca debe mostrarse como $0',
);
assert.match(
  salesScreen,
  /entry\.origin\s*===\s*['"]local['"][\s\S]*(?:Local|local)/,
  'cada venta debe mostrar si aún proviene del dispositivo',
);
assert.match(
  salesScreen,
  /entry\.origin\s*===\s*['"]odoo['"][\s\S]*Odoo/,
  'cada venta remota debe mostrar su origen autoritativo',
);
assert.match(
  salesScreen,
  /getSaleStatusCopy\(/,
  'la pantalla debe delegar el copy de estados al mapper puro',
);
assert.match(
  salesScreen,
  /async function openTicketForEntry/,
  'la navegación debe decidir por origen de la entrada',
);
assert.match(
  salesScreen,
  /entry\.origin\s*===\s*['"]local['"][\s\S]*entry\.ticketSnapshot[\s\S]*router\.push\(`\/print\/\$\{ticketId\}`/,
  'una venta local con snapshot debe abrir el ticket persistido sin consultar Odoo',
);
assert.match(
  salesScreen,
  /entry\.remoteOrder[\s\S]*openTicketForOrder\(entry\.remoteOrder\)/,
  'una venta Odoo debe conservar el flujo autoritativo existente',
);
assert.match(
  salesScreen,
  /disabled=\{[^}]*entry\.origin\s*===\s*['"]local['"][^}]*!entry\.ticketSnapshot/,
  'una venta local sin ticket debe indicar que no está disponible y evitar crash',
);
assert.match(
  salesScreen,
  /ticketsLoading[\s\S]*(?:Preparando|Cargando) comprobantes/,
  'la lectura de tickets debe ser visible y no bloquear toda la lista',
);
assert.match(
  salesScreen,
  /RefreshControl/,
  'la lista debe conservar pull-to-refresh',
);
assert.match(
  salesScreen,
  /loadTodaySales\(\{\s*force:\s*true\s*\}\)/,
  'pull-to-refresh debe forzar solo la carga oficial y coalescida',
);
assert.match(
  salesScreen,
  /error[\s\S]*entries\.length/,
  'un error remoto debe convivir con las ventas locales visibles',
);

console.log('sales pending UI wiring tests: ok');
