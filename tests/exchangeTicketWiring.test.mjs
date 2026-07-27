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
  assert.match(source, /TICKET DE CAMBIO/);
  assert.match(source, /Grupo Frio/);
  assert.match(source, /Cliente/);
  assert.match(source, /Folio/);
  assert.match(source, /Entrega/);
  assert.match(source, /Merma/);
  assert.match(source, /Notas/);
  assert.match(source, /showOutputActionsWhenMissing/);
  assert.match(source, /snapshotId/);
  assert.doesNotMatch(source, /Pago|paymentLabel|formatCurrency|totalKg|Total/);
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
