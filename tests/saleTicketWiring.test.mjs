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
  const customerPricingRepository = readFileSync(
    resolve(REPO_ROOT, 'src/services/customerPricingSnapshotRepository.ts'),
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
    saleTicketPdfService,
    /paymentMethod === 'credit'/,
    'El PDF debe aumentar altura cuando el ticket incluye leyenda de credito',
  );
  assert.doesNotMatch(
    printScreen,
    /KOLD FIELD/,
    'La vista previa del ticket ya no debe mostrar la marca anterior',
  );
  const remoteOpenStart = salesScreen.indexOf('async function openTicketForOrder');
  const remoteOpenEnd = salesScreen.indexOf('\n  return (', remoteOpenStart);
  const remoteOpenBody = salesScreen.slice(remoteOpenStart, remoteOpenEnd);
  const authoritativeSaveIndex = remoteOpenBody.indexOf('await saveAuthoritativeSaleTicketSnapshot');
  const printNavigationIndex = remoteOpenBody.indexOf('router.push(`/print/${ticketId}`');
  assert(remoteOpenStart >= 0, 'Ventas debe conservar el handler de apertura remota');
  assert(
    authoritativeSaveIndex >= 0 && authoritativeSaveIndex < printNavigationIndex,
    'Ventas debe persistir el ticket Odoo autoritativo antes de navegar al PDF',
  );
  assert.match(
    remoteOpenBody,
    /buildSaleTicketSnapshotFromOrder\(order\)/,
    'Ventas debe construir el ticket remoto desde las lineas definitivas de /sales/list',
  );
  assert.match(
    remoteOpenBody,
    /operation_id\.trim\(\)/,
    'Ventas debe usar el operation_id remoto normalizado y no un folio inventado',
  );
  assert.doesNotMatch(
    salesScreen,
    /customerPricingSnapshot|CUSTOMER_PRICING_SNAPSHOTS|replaceCustomerPricing|updateCustomerPricing/,
    'Abrir tickets desde /sales/list no debe mutar snapshots ni el ledger de precios',
  );
  assert.doesNotMatch(
    customerPricingRepository,
    /sale-ticket:/,
    'El repositorio de pricing debe permanecer aislado de las llaves de tickets',
  );

  console.log('sale ticket wiring tests: ok');
}

main();
