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
  const saleTicketStorageService = readFileSync(
    resolve(REPO_ROOT, 'src/services/saleTicketStorage.ts'),
    'utf8',
  );
  const saleRecoveryIntentService = readFileSync(
    resolve(REPO_ROOT, 'src/services/saleRecoveryIntent.ts'),
    'utf8',
  );
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
  assert.match(
    salesScreen,
    /useRef\(createSaleTicketOpenGuard\(\)\)/,
    'Ventas debe conservar un guard de aperturas remotas durante la vida de la pantalla',
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
  assert.match(
    saleTicketService,
    /export function parseSaleTicketSnapshot/,
    'El dominio de ticket debe exponer un unico parser runtime defensivo',
  );
  assert(
    (saleTicketStorageService.match(/parseSaleTicketSnapshot\(/g) ?? []).length >= 3,
    'Las lecturas, precedencia y escrituras de ticket deben compartir el parser runtime',
  );
  assert.match(
    saleRecoveryIntentService,
    /parseSaleTicketSnapshot\(\s*value\.ticketSnapshot,\s*value\.operationId\s*,?\s*\)/,
    'La recuperacion de venta debe usar el mismo parser runtime de storage/print',
  );
  assert.doesNotMatch(
    saleRecoveryIntentService,
    /function restoreTicketSnapshot/,
    'La recuperacion no debe mantener un segundo parser divergente',
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
    /async function openTicketForOrder\(order: GFSalesOrder\) \{([\s\S]*?)\n  \}/,
  );
  assert.ok(openTicketMatch, 'Ventas debe definir openTicketForOrder');
  const openTicketBody = openTicketMatch[1];

  assert.match(
    openTicketBody,
    /const\s+ticketKey\s*=\s*order\.operation_id\.trim\(\)\s*\|\|\s*`odoo-order-\$\{order\.id\}`/,
    'Ventas debe deduplicar por operation_id y conservar un fallback determinista',
  );
  assert.match(
    openTicketBody,
    /await\s+ticketOpenGuardRef\.current\.run\(\s*ticketKey,/,
    'Toques repetidos no deben encolar guardados ni navegaciones duplicados',
  );
  assert.match(
    openTicketBody,
    /await\s+openSaleTicketForOrder\(order,\s*\{/,
    'Ventas debe ejecutar el flujo seguro dentro del guard de apertura',
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
    /navigate:\s*\(saleId\)\s*=>\s*\{[\s\S]*?router\.push\(`\/print\/\$\{ticketId\}`/,
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
