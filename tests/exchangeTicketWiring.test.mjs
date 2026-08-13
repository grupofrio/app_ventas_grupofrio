import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

function read(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

test('shared ticket output screen exists and centralizes printer workflow seams', () => {
  const componentPath = resolve(REPO_ROOT, 'src/components/domain/TicketOutputScreen.tsx');
  assert.ok(existsSync(componentPath), 'Debe existir TicketOutputScreen para compartir el flujo de impresion');

  const source = read('src/components/domain/TicketOutputScreen.tsx');
  assert.match(source, /createThermalPrinterService/);
  assert.match(source, /createThermalPrinterSelectionStore/);
  assert.match(source, /ThermalPrinterPicker/);
  assert.match(source, /beginOutput/);
  assert.match(source, /createExplicitReprintAction/);
  assert.match(source, /openSettingsSafely/);
  assert.match(source, /printActionLabel = 'Imprimir en MP210'/);
  assert.match(source, /pdfActionLabel = 'Abrir PDF'/);
});

test('exchange print route wires snapshot loading, PDF opening, thermal builder, and preview labels', () => {
  const screenPath = resolve(REPO_ROOT, 'app/print-exchange/[snapshotId].tsx');
  assert.ok(existsSync(screenPath), 'Debe existir la ruta de impresion para tickets de cambio');

  const source = read('app/print-exchange/[snapshotId].tsx');
  assert.match(source, /TicketOutputScreen/);
  assert.match(source, /loadExchangeTicketSnapshot/);
  assert.match(source, /openExchangeTicketPdf/);
  assert.match(source, /buildExchangeThermalTicketDocument/);
  assert.match(source, /formatTicketDate/);
  assert.match(source, /import \{ formatQuantity, formatTicketDate \} from .*saleTicketFormatting/);
  assert.match(source, /TICKET DE CAMBIO/);
  assert.match(source, /Grupo Frio/);
  assert.match(source, /Cliente/);
  assert.match(source, /Folio/);
  assert.match(source, /PRODUCTO ENTREGADO/);
  assert.match(source, /PRODUCTO RECOGIDO \/ MERMA/);
  assert.match(source, /formatQuantity/);
  assert.match(source, /formatQuantity\(line\.qty\)/);
  assert.match(source, /Cambio registrado correctamente/);
  assert.match(source, /if \(lines\.length === 0\) return null/);
  assert.match(source, /Notas/);
  assert.match(source, /showOutputActionsWhenMissing/);
  assert.match(source, /snapshotId/);
  assert.doesNotMatch(source, /Pago|paymentLabel|formatCurrency|totalKg|Total/);
});

test('exchange line preview keys remain unique when a product appears more than once', () => {
  const source = read('app/print-exchange/[snapshotId].tsx');
  assert.match(source, /lines\.map\(\(line, index\) =>/);
  assert.match(source, /key=\{`\$\{title\}-\$\{line\.productId\}-\$\{index\}`\}/);
});

test('sale print route becomes a wrapper over the shared output screen without changing sale wiring', () => {
  const source = read('app/print/[orderId].tsx');
  assert.match(source, /TicketOutputScreen/);
  assert.match(source, /loadSaleTicketSnapshot/);
  assert.match(source, /openSaleTicketPdf/);
  assert.match(source, /buildThermalTicketDocument/);
  assert.match(source, /GRUPO FRIO/);
  assert.match(source, /SALE_TICKET_LEGAL_NAME/);
  assert.match(source, /SALE_TICKET_RFC/);
  assert.match(source, /Abrir PDF/);
  assert.match(source, /Imprimir en MP210/);
});

test('exchange submit wires local snapshot creation, strict save, and exchange ticket navigation', () => {
  const source = read('app/exchange/[stopId].tsx');

  assert.match(source, /buildExchangeTicketSnapshot/);
  assert.match(source, /saveExchangeTicketSnapshot/);
  assert.match(source, /const idempotencyKey = getExchangeIdempotencyKey\(\);/);
  assert.match(source, /let registeredMessage = 'Cambio procesado';/);
  assert.match(source, /idempotency_key:\s*idempotencyKey/);
  assert.match(source, /registeredMessage = response\.user_message \|\| registeredMessage/);
  assert.match(source, /response\.data\.exchange_name/);
  assert.match(source, /response\.data\.exchange_id/);
  assert.match(source, /customerName:\s*currentStop\.customer_name/);
  assert.match(source, /createdAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(source, /const deliverySnapshotLines:[\s\S]*deliveryPayloadLines\.map\(\(line\) => \(\{/);
  assert.match(source, /const mermaSnapshotLines:[\s\S]*mermaPayloadLines\.map\(\(line\) => \(\{/);
  assert.match(source, /deliveryLines:\s*deliverySnapshotLines/);
  assert.match(source, /mermaLines:\s*mermaSnapshotLines/);
  assert.match(source, /productName:\s*productMap\.get\(line\.product_id\)\?\.name/);
  assert.match(source, /await saveExchangeTicketSnapshot\(snapshot\)/);
  assert.match(source, /pathname:\s*'\/print-exchange\/\[snapshotId\]'/);
  assert.match(source, /snapshotId:\s*snapshot\.snapshotId/);

  const createExchangeIndex = source.indexOf('response = await createExchange({');
  const saveSnapshotIndex = source.indexOf('await saveExchangeTicketSnapshot(snapshot);');
  const printRouteIndex = source.indexOf("pathname: '/print-exchange/[snapshotId]'");

  assert.ok(createExchangeIndex >= 0, 'debe existir la llamada createExchange');
  assert.ok(saveSnapshotIndex > createExchangeIndex, 'el snapshot solo debe guardarse tras exito backend');
  assert.ok(printRouteIndex > saveSnapshotIndex, 'la navegacion al ticket debe ocurrir despues del guardado');
});
