import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const saleScreen = readFileSync(
    resolve(REPO_ROOT, 'app/sale/[stopId].tsx'),
    'utf8',
  );
  const visitStore = readFileSync(
    resolve(REPO_ROOT, 'src/stores/useVisitStore.ts'),
    'utf8',
  );

  assert.doesNotMatch(
    saleScreen,
    /disabled=\{!canConfirm\}/,
    'Confirmar Pedido debe quedar tocable para mostrar el motivo cuando faltan datos',
  );
  assert.match(
    saleScreen,
    /disabled=\{saleInputsLocked \|\| !onlineInventoryReady\}/,
    'Confirmar Pedido debe conservar el lock síncrono y sumar el guard de autoridad online',
  );
  assert.match(
    saleScreen,
    /const \[saleSubmitting,\s*setSaleSubmitting\]/,
    'La pantalla debe rastrear cuando la venta esta en envio para no avanzar a checkout antes de que Odoo responda',
  );
  assert.match(
    saleScreen,
    /shouldResumeAfterSale\(\{[\s\S]*?saleConfirmed,[\s\S]*?hasAfterSaleAction:\s*afterSaleAction !== null,[\s\S]*?stopExists:\s*stop !== undefined,[\s\S]*?saleSubmitting,[\s\S]*?saleRecoveryPersistenceFailed,[\s\S]*?saleReadyToContinue,[\s\S]*?hasQueuedSaleOrderEvidence:[\s\S]*?\}\)/,
    'La reanudacion debe usar la decision pura que tambien considera el bloqueo persistido',
  );
  assert.match(
    saleScreen,
    /React\.useRef[^\n]*SaleConfirmationSingleFlight|React\.useRef<[^>]*SaleConfirmationSingleFlight/,
    'La pantalla debe conservar una sola instancia single-flight por montaje',
  );
  const confirmStart = saleScreen.indexOf('async function handleConfirm()');
  const freshConfirmedIndex = saleScreen.indexOf('useVisitStore.getState().saleConfirmed', confirmStart);
  const acquireIndex = saleScreen.indexOf('saleConfirmationSingleFlight.tryAcquire()', confirmStart);
  const submittingIndex = saleScreen.indexOf('setSaleSubmitting(true)', acquireIndex);
  const captureIndex = saleScreen.indexOf('const confirmationInput = readLiveSaleSubmissionInput()', acquireIndex);
  const validationIndex = saleScreen.indexOf('if (!confirmedPaymentMethod)', captureIndex);
  const lockIndex = saleScreen.indexOf('lockSaleConfirm()', validationIndex);
  assert(
    freshConfirmedIndex > confirmStart
      && acquireIndex > freshConfirmedIndex
      && submittingIndex > acquireIndex
      && captureIndex > submittingIndex
      && validationIndex > captureIndex
      && lockIndex > validationIndex,
    'El guard atomico congela inputs antes del snapshot y conserva el lock durable después de validar',
  );
  const unlockCount = (saleScreen.match(/\bunlockSaleConfirm\(\)/g) ?? []).length;
  const releaseCount = (saleScreen.match(/\bsaleConfirmationSingleFlight\.release\(\)/g) ?? []).length;
  assert.equal(unlockCount, 2, 'solo fallos previos a la barrera durable usan el unlock tolerante');
  assert.equal(releaseCount, 1, 'el single-flight sólo se libera mediante el helper centralizado');
  assert(
    (saleScreen.match(/\breleaseSaleInputMutationLock\(\)/g) ?? []).length >= 14,
    'todos los abortos recuperables deben usar el helper centralizado',
  );
  const durableBarrierIndex = saleScreen.indexOf(
    'await persistSaleConfirmationLock(operationId, recoveryIntent)',
  );
  assert.equal(
    saleScreen.indexOf('unlockSaleConfirm()', durableBarrierIndex),
    -1,
    'después de persistir el lock no debe usarse el unlock tolerante',
  );
  assert.match(
    saleScreen,
    /releaseSaleInputMutationLock\(\);\s*unlockSaleConfirm\(\);/,
    'release y unlock deben permanecer juntos',
  );
  assert.match(
    saleScreen,
    /await createSale\(buildSalesCreatePayload\(payload\)\)[\s\S]*?setSaleSubmitting\(false\)/,
    'La venta online debe terminar el estado de envio solo despues de que createSale responda',
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
    /const saleOffrouteVisitId = confirmationOffrouteVisitId;[\s\S]*?offroute_visit_id:\s*isOffRoute\s*\?\s*saleOffrouteVisitId\s*:\s*null/,
    'La venta de visita especial debe mandar offroute_visit_id para que el corte incluya sus salidas',
  );
  assert.doesNotMatch(
    saleScreen,
    /defaultPaymentJournalId|hasCashPaymentJournal|diario de efectivo del CEDIS|Configura el diario de efectivo/,
    'La venta en efectivo no debe bloquearse si el login no incluyo default_payment_journal_id; backend resuelve el diario del empleado',
  );
  assert.match(
    saleScreen,
    /payment_method:\s*confirmedPaymentMethod/,
    'La venta debe enviar al backend el metodo seleccionado para que efectivo cree pago atomico',
  );
  assert.match(
    saleScreen,
    /create_invoice:\s*confirmedPaymentMethod === 'cash'/,
    'Una venta en efectivo debe pedir al backend generar el account.move',
  );
  assert.doesNotMatch(
    saleScreen,
    /salePaymentMethod === 'cash'[\s\S]*?enqueue\('payment'/,
    'El efectivo no debe depender de un segundo item de sync; el backend crea el pago con la venta',
  );

  assert.match(visitStore, /saleRecoveryPersistenceFailed:\s*boolean/);
  assert.match(visitStore, /saleReadyToContinue:\s*boolean/);
  assert.match(visitStore, /setSaleRecoveryPersistenceFailed:\s*\(value:\s*boolean\)\s*=>\s*void/);
  assert.match(
    visitStore,
    /markSaleReadyToContinue:\s*\([\s\S]*?operationId:\s*string[\s\S]*?clearOperationId\?:\s*boolean[\s\S]*?Promise<boolean>/,
    'el store expone la transición terminal async',
  );
  assert.match(
    visitStore,
    /persistSaleConfirmationLock:\s*\([\s\S]*?operationId:\s*string,[\s\S]*?intent:\s*SaleRecoveryIntentV1,[\s\S]*?\)\s*=>\s*Promise<boolean>/,
    'el store expone la barrera strict previa a side effects',
  );
  assert.match(
    visitStore,
    /setSaleRecoveryPersistenceFailed:\s*\(value\)\s*=>\s*\{[\s\S]*?set\(\{\s*saleRecoveryPersistenceFailed:\s*value\s*\}\);[\s\S]*?persistVisitStateInBackground/,
    'la accion del flag debe actualizar y persistir el snapshot',
  );
  assert.match(
    visitStore,
    /if \(get\(\)\.saleConfirmed && existing\)\s*\{\s*return existing;\s*\}[\s\S]*?saleReadyToContinue:\s*false,[\s\S]*?saleRecoveryPersistenceFailed:\s*false/,
    'un lock nuevo limpia marker y flag, pero reutilizar un lock confirmado conserva la recuperación',
  );
  assert.match(
    visitStore,
    /unlockSaleConfirm:[\s\S]*?saleConfirmed:\s*false,[\s\S]*?saleOperationId:\s*null,[\s\S]*?saleReadyToContinue:\s*false,[\s\S]*?saleRecoveryPersistenceFailed:\s*false/,
    'unlock limpia tambien marker y bloqueo de recuperacion',
  );
  assert.match(
    visitStore,
    /createVisitStatePersistenceCoordinator<VisitState,\s*PersistedVisitSnapshot>/,
    'todos los writes de visita comparten un coordinador serializado',
  );
  assert.match(visitStore, /storeSaveStrict\(STORAGE_KEYS\.VISIT_STATE, snapshot\)/);
  assert.match(visitStore, /storeRemoveStrict\(STORAGE_KEYS\.VISIT_STATE\)/);
  assert.doesNotMatch(
    visitStore,
    /\bstoreSave\(|\bstoreRemove\(/,
    'VISIT_STATE no usa wrappers tolerantes que oculten fallos o compitan',
  );
  assert.match(
    visitStore,
    /persistVisitStateInBackground[\s\S]*?\.persistCurrent\(\)\.catch\(/,
    'los writes normales capturan y registran rechazos sin unhandled rejection',
  );
  assert.match(
    visitStore,
    /markSaleReadyToContinue:\s*\(operationId, options\)\s*=>[\s\S]*?visitStatePersistence\.markSaleReadyToContinue\(operationId, options\)/,
    'la acción crítica consume el mismo runner sin reentrada',
  );
  assert.match(
    visitStore,
    /persistSaleConfirmationLock:\s*\(operationId, intent\)\s*=>[\s\S]*?visitStatePersistence\.persistSaleConfirmationLock\([\s\S]*?operationId,[\s\S]*?createSaleRecoveryIntent\(intent\)/,
    'la barrera del lock consume el mismo runner serializado',
  );

  console.log('sale confirm feedback tests: ok');
}

main();
