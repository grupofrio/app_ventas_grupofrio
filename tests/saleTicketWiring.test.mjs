import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const saleScreen = readFileSync(resolve(REPO_ROOT, 'app/sale/[stopId].tsx'), 'utf8');
  const salesScreen = readFileSync(resolve(REPO_ROOT, 'app/(tabs)/sales.tsx'), 'utf8');
  const printScreen = readFileSync(resolve(REPO_ROOT, 'app/print/[orderId].tsx'), 'utf8');
  const saleTicketService = readFileSync(resolve(REPO_ROOT, 'src/services/saleTicket.ts'), 'utf8');
  const saleTicketBrandingService = readFileSync(
    resolve(REPO_ROOT, 'src/services/saleTicketBranding.ts'),
    'utf8',
  );
  const saleTicketPdfService = readFileSync(resolve(REPO_ROOT, 'src/services/saleTicketPdf.ts'), 'utf8');
  const saleTicketPdfHeightService = readFileSync(
    resolve(REPO_ROOT, 'src/services/saleTicketPdfHeight.ts'),
    'utf8',
  );

  assert.match(
    saleScreen,
    /buildSaleTicketSnapshot|saveSaleTicketSnapshot/,
    'La confirmacion de venta online debe guardar tickets locales para imprimir desde ventas o visita especial',
  );
  assert.match(
    saleScreen,
    /Ver ticket PDF/,
    'La confirmacion de venta debe ofrecer Ver ticket PDF inmediatamente despues de vender',
  );
  assert.match(
    printScreen,
    /loadSaleTicketSnapshot/,
    'La pantalla de impresion debe cargar el snapshot local del ticket',
  );
  assert.match(
    printScreen,
    /openSaleTicketPdf/,
    'La pantalla de impresion debe abrir el PDF con el visor del sistema',
  );
  assert.match(
    printScreen,
    /Abrir PDF/,
    'La pantalla de impresion debe exponer el boton Abrir PDF',
  );
  assert.match(
    printScreen,
    /Imprimir en MP210/,
    'La pantalla de impresion debe exponer el envio directo a la MP210',
  );
  assert.match(
    printScreen,
    /buildThermalTicketDocument/,
    'La impresion termica debe construirse desde el mismo snapshot local del ticket',
  );
  assert.match(
    printScreen,
    /GRUPO FRIO/,
    'La vista previa del ticket debe mostrar la marca Grupo Frio',
  );
  assert.match(
    saleTicketBrandingService,
    /SOLUCIONES EN PRODUCCION GLACIEM/,
    'El branding compartido debe declarar la razon social',
  );
  assert.match(
    saleTicketBrandingService,
    /SPG230420F52/,
    'El branding compartido debe declarar el RFC',
  );
  assert.match(
    saleTicketService,
    /import\s+\{\s*SALE_TICKET_BRANDING\s*\}\s+from\s+['"]\.\/saleTicketBranding(?:\.ts)?['"]/,
    'El ticket debe consumir el branding compartido',
  );
  assert.match(
    printScreen,
    /SALE_TICKET_LEGAL_NAME/,
    'La vista previa del ticket debe renderizar la razon social',
  );
  assert.match(
    printScreen,
    /SALE_TICKET_RFC/,
    'La vista previa del ticket debe renderizar el RFC',
  );
  assert.match(
    printScreen,
    /formatTicketDate\(ticket\.createdAt\)/,
    'La vista previa del ticket debe renderizar la fecha CDMX formateada',
  );
  assert.match(
    printScreen,
    /formatTicketCurrency\(ticket\.subtotal\)/,
    'La vista previa del ticket debe renderizar el subtotal con el helper compartido',
  );
  assert.match(
    printScreen,
    /SALE_TICKET_BRANDING\.title/,
    'La vista previa del ticket debe renderizar el titulo compartido',
  );
  assert.match(
    printScreen,
    /SALE_TICKET_BRANDING\.footer/,
    'La vista previa del ticket debe renderizar el pie compartido',
  );
  assert.match(
    printScreen,
    /formatQuantityAndUnitPrice\(line\.qty, line\.unitPrice\)/,
    'La vista previa debe usar la misma cantidad/precio que el ticket impreso',
  );
  assert.match(
    saleTicketPdfService,
    /getSaleTicketPdfHeight\(snapshot\)/,
    'El PDF debe aumentar altura cuando el ticket incluye leyenda de credito',
  );
  assert.match(
    saleTicketPdfHeightService,
    /paymentMethod === 'credit'/,
    'La reserva de altura debe contemplar tickets a credito',
  );
  assert.doesNotMatch(
    printScreen,
    /KOLD FIELD/,
    'La vista previa del ticket ya no debe mostrar la marca anterior',
  );

  assert.match(
    salesScreen,
    /import\s+\{\s*openSaleTicketForOrder\s*\}\s+from\s+['"]\.\.\/\.\.\/src\/services\/saleTicketOpen['"]/,
    'Ventas debe delegar la apertura a un flujo seguro e inyectable',
  );
  assert.match(
    salesScreen,
    /loadSaleTicketSnapshotStrict/,
    'Ventas debe usar lectura estricta antes de combinar y guardar el ticket',
  );
  assert.doesNotMatch(
    salesScreen,
    /\bloadSaleTicketSnapshot\b/,
    'Ventas no debe usar la lectura tolerante en el flujo read-modify-write',
  );

  const openTicketMatch = salesScreen.match(
    /function openTicketForOrder\(order: GFSalesOrder\) \{([\s\S]*?)\n  \}/,
  );
  assert.ok(openTicketMatch, 'Ventas debe definir openTicketForOrder');
  const openTicketBody = openTicketMatch[1];

  assert.match(
    openTicketBody,
    /return\s+openSaleTicketForOrder\(order,\s*\{/,
    'Ventas debe retornar el resultado seguro del flujo de apertura',
  );
  assert.match(
    openTicketBody,
    /load:\s*loadSaleTicketSnapshotStrict/,
    'Ventas debe inyectar la lectura estricta',
  );
  assert.match(
    openTicketBody,
    /save:\s*saveSaleTicketSnapshot/,
    'Ventas debe inyectar el guardado estricto',
  );
  assert.match(
    openTicketBody,
    /navigate:\s*\(ticketId\)\s*=>\s*router\.push\(`\/print\/\$\{ticketId\}`/,
    'Ventas debe navegar solo mediante el callback del flujo seguro',
  );
  assert.match(
    openTicketBody,
    /onError:\s*showTicketOpenError/,
    'Ventas debe mostrar feedback sanitizado cuando el flujo falla',
  );
  assert.match(
    salesScreen,
    /Alert\.alert\(\s*['"]No se pudo abrir el ticket['"]/,
    'Ventas debe mantener la pantalla actual y explicar que el ticket no se abrio',
  );
  assert.match(
    salesScreen,
    /console\.error\(\s*['"][^'"]+['"]\s*\)/,
    'Ventas debe registrar un mensaje sanitizado sin exponer el error original',
  );

  console.log('sale ticket wiring tests: ok');
}

main();
