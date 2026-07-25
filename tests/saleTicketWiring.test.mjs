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
    saleTicketPdfService,
    /paymentMethod === 'credit'/,
    'El PDF debe aumentar altura cuando el ticket incluye leyenda de credito',
  );
  assert.doesNotMatch(
    printScreen,
    /KOLD FIELD/,
    'La vista previa del ticket ya no debe mostrar la marca anterior',
  );

  const openTicketMatch = salesScreen.match(
    /async function openTicketForOrder\(order: GFSalesOrder\) \{([\s\S]*?)\n  \}/,
  );
  assert.ok(openTicketMatch, 'Ventas debe definir openTicketForOrder');
  const openTicketBody = openTicketMatch[1];

  const authoritativeMatch = openTicketBody.match(
    /const\s+(\w+)\s*=\s*buildSaleTicketSnapshotFromOrder\(order\)/,
  );
  assert.ok(
    authoritativeMatch,
    'Ventas debe derivar el ticket autoritativo para obtener el saleId tecnico',
  );
  assert.match(
    openTicketBody,
    new RegExp(`loadSaleTicketSnapshot\\(${authoritativeMatch[1]}\\.saleId\\)`),
    'Ventas debe cargar el snapshot actual usando el saleId tecnico autoritativo',
  );

  const mergedMatch = openTicketBody.match(
    /const\s+(\w+)\s*=\s*mergeSaleTicketFromOrder\(\w+,\s*order\)/,
  );
  assert.ok(
    mergedMatch,
    'Ventas debe combinar el snapshot local con folio y vendedor autoritativos',
  );
  assert.match(
    openTicketBody,
    new RegExp(`await\\s+saveSaleTicketSnapshot\\(${mergedMatch[1]}\\)`),
    'Ventas siempre debe guardar el ticket combinado aunque ya exista localmente',
  );
  const ticketIdMatch = openTicketBody.match(
    new RegExp(`const\\s+(\\w+)\\s*=\\s*${mergedMatch[1]}\\.saleId`),
  );
  assert.ok(
    ticketIdMatch,
    'Ventas debe derivar el id de navegacion desde el ticket combinado',
  );
  assert.match(
    openTicketBody,
    new RegExp(`router\\.push\\(\\\`/print/\\$\\{${ticketIdMatch[1]}\\}\\\``),
    'Ventas debe navegar usando el saleId del ticket combinado',
  );
  assert.doesNotMatch(
    openTicketBody,
    /if\s*\(\s*!\s*\w+\s*\)/,
    'Ventas no debe omitir el guardado cuando ya existe un ticket local',
  );

  console.log('sale ticket wiring tests: ok');
}

main();
