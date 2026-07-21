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
    /disabled=\{saleConfirmed\}/,
    'Confirmar Pedido solo debe deshabilitarse despues de guardar para evitar doble tap',
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
  const validationIndex = saleScreen.indexOf('if (!confirmedPaymentMethod) return;');
  const freshConfirmedIndex = saleScreen.indexOf('useVisitStore.getState().saleConfirmed', validationIndex);
  const acquireIndex = saleScreen.indexOf('saleConfirmationSingleFlight.tryAcquire()', validationIndex);
  const submittingIndex = saleScreen.indexOf('setSaleSubmitting(true)', validationIndex);
  const lockIndex = saleScreen.indexOf('lockSaleConfirm()', validationIndex);
  assert(
    validationIndex >= 0
      && freshConfirmedIndex > validationIndex
      && acquireIndex > freshConfirmedIndex
      && submittingIndex > acquireIndex
      && lockIndex > submittingIndex,
    'El guard atomico usa estado fresco despues de validar y antes de submitting/lock',
  );
  const unlockCount = (saleScreen.match(/\bunlockSaleConfirm\(\)/g) ?? []).length;
  const releaseCount = (saleScreen.match(/\bsaleConfirmationSingleFlight\.release\(\)/g) ?? []).length;
  assert.equal(unlockCount, 2, 'solo preparacion y rechazo definitivo desbloquean la venta');
  assert.equal(releaseCount, unlockCount, 'cada unlock debe liberar tambien el single-flight');
  assert.match(
    saleScreen,
    /saleConfirmationSingleFlight\.release\(\);\s*unlockSaleConfirm\(\);|unlockSaleConfirm\(\);\s*saleConfirmationSingleFlight\.release\(\);/,
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
    /persistSaleConfirmationLock:\s*\(operationId:\s*string\)\s*=>\s*Promise<boolean>/,
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
    /persistSaleConfirmationLock:\s*\(operationId\)\s*=>[\s\S]*?visitStatePersistence\.persistSaleConfirmationLock\(operationId\)/,
    'la barrera del lock consume el mismo runner serializado',
  );

  console.log('sale confirm feedback tests: ok');
}

main();
