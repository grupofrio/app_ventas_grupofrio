import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const saleScreen = readFileSync(resolve(REPO_ROOT, 'app/sale/[stopId].tsx'), 'utf8');
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

  console.log('sale ticket wiring tests: ok');
}

main();
