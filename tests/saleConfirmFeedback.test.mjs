import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const saleScreen = readFileSync(
    resolve(REPO_ROOT, 'app/sale/[stopId].tsx'),
    'utf8',
  );

  assert.doesNotMatch(
    saleScreen,
    /disabled=\{!canConfirm\}/,
    'Confirmar Pedido debe quedar tocable para mostrar el motivo cuando faltan datos',
  );
  assert.match(
    saleScreen,
    /disabled=\{saleConfirmed\}/,
    'Confirmar Pedido solo debe deshabilitarse despues de guardar para evitar doble tap',
  );
  assert.match(
    saleScreen,
    /hasWarehouse/,
    'La pantalla de venta debe validar que el empleado tenga almacen antes de confirmar',
  );
  assert.match(
    saleScreen,
    /almac[eé]n del empleado/,
    'Si falta warehouseId, el aviso de faltantes debe mencionar el almacen del empleado',
  );
  assert.match(
    saleScreen,
    /await getPartnerPricelistId\(/,
    'La confirmacion debe resolver la lista de precio antes de armar el payload, no depender solo del cache',
  );
  assert.match(
    saleScreen,
    /peekResolvedPartnerPricelistId\(/,
    'Despues de resolver, la confirmacion debe mandar solo listas especificas cacheadas como seguras',
  );
  assert.match(
    saleScreen,
    /stop\._pricelistId/,
    'La confirmacion de visita especial debe usar la lista capturada en la parada virtual',
  );
  assert.match(
    saleScreen,
    /const saleOffrouteVisitId = offrouteVisitId \?\? stop\._offrouteVisitId \?\? null;[\s\S]*?offroute_visit_id:\s*isOffRoute\s*\?\s*saleOffrouteVisitId\s*:\s*null/,
    'La venta de visita especial debe mandar offroute_visit_id para que el corte incluya sus salidas',
  );
  assert.doesNotMatch(
    saleScreen,
    /defaultPaymentJournalId|hasCashPaymentJournal|diario de efectivo del CEDIS|Configura el diario de efectivo/,
    'La venta en efectivo no debe bloquearse si el login no incluyo default_payment_journal_id; backend resuelve el diario del empleado',
  );
  assert.match(
    saleScreen,
    /payment_method:\s*salePaymentMethod/,
    'La venta debe enviar al backend el metodo seleccionado para que efectivo cree pago atomico',
  );
  assert.match(
    saleScreen,
    /create_invoice:\s*salePaymentMethod === 'cash'/,
    'Una venta en efectivo debe pedir al backend generar el account.move',
  );
  assert.doesNotMatch(
    saleScreen,
    /salePaymentMethod === 'cash'[\s\S]*?enqueue\('payment'/,
    'El efectivo no debe depender de un segundo item de sync; el backend crea el pago con la venta',
  );

  console.log('sale confirm feedback tests: ok');
}

main();
