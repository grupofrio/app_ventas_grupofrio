import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const sale = readFileSync(
  resolve(process.cwd(), 'app/sale/[stopId].tsx'),
  'utf8',
);
const saleSourceFile = ts.createSourceFile(
  'sale.tsx',
  sale,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const syntaxNodes = [];
function collectSyntaxNodes(node) {
  syntaxNodes.push(node);
  ts.forEachChild(node, collectSyntaxNodes);
}
collectSyntaxNodes(saleSourceFile);

function blockDetails(source, block) {
  const openBraceIndex = block.getStart(saleSourceFile);
  const closeBraceIndex = block.end - 1;
  assert.equal(sale[openBraceIndex], '{', 'el AST debe localizar la llave inicial');
  assert.equal(sale[closeBraceIndex], '}', 'el AST debe localizar la llave final');
  return {
    openBraceIndex,
    closeBraceIndex,
    body: sale.slice(openBraceIndex + 1, closeBraceIndex),
  };
}

function sourceOffset(source) {
  if (source === sale) return 0;
  const offset = sale.indexOf(source);
  assert.notEqual(offset, -1, 'el fragmento analizado debe pertenecer al TSX');
  return offset;
}

function blockAfter(source, marker, fromIndex = 0) {
  const markerIndex = source.indexOf(marker, fromIndex);
  assert.notEqual(markerIndex, -1, `no se encontro el marcador: ${marker}`);
  const offset = sourceOffset(source);
  const globalMarkerIndex = offset + markerIndex;
  const block = syntaxNodes
    .filter(ts.isBlock)
    .filter((candidate) => (
      candidate.getStart(saleSourceFile) >= globalMarkerIndex + marker.length
    ))
    .sort((left, right) => left.getStart(saleSourceFile) - right.getStart(saleSourceFile))[0];
  assert(block, `no se encontro el bloque AST de: ${marker}`);
  const details = blockDetails(source, block);
  return {
    markerIndex,
    openBraceIndex: details.openBraceIndex - offset,
    closeBraceIndex: details.closeBraceIndex - offset,
    body: details.body,
  };
}

function tryCatchContaining(source, needle, fromIndex = 0) {
  const needleIndex = source.indexOf(needle, fromIndex);
  assert.notEqual(needleIndex, -1, `no se encontro la operacion: ${needle}`);
  const offset = sourceOffset(source);
  const globalNeedleIndex = offset + needleIndex;

  const candidates = syntaxNodes
    .filter(ts.isTryStatement)
    .filter((candidate) => (
      candidate.tryBlock.getStart(saleSourceFile) < globalNeedleIndex
      && globalNeedleIndex < candidate.tryBlock.end
    ))
    .sort((left, right) => (
      right.tryBlock.getStart(saleSourceFile) - left.tryBlock.getStart(saleSourceFile)
    ));

  assert(candidates.length > 0, `${needle} debe estar dentro de un try`);
  const statement = candidates[0];
  assert(statement.catchClause, `el try de ${needle} debe tener catch`);
  const tryBlock = blockDetails(source, statement.tryBlock);
  const catchBlock = blockDetails(source, statement.catchClause.block);

  return {
    needleIndex,
    tryStart: statement.getStart(saleSourceFile) - offset,
    tryEnd: tryBlock.closeBraceIndex - offset,
    tryBody: tryBlock.body,
    catchStart: catchBlock.openBraceIndex - offset,
    catchEnd: catchBlock.closeBraceIndex - offset,
    catchBody: catchBlock.body,
  };
}

// La llamada remota debe tener un limite de error dedicado: fotos/ticket son
// post-confirmacion y no pueden convertir una venta valida en un reintento.
const createPhase = tryCatchContaining(
  sale,
  'await createSale(buildSalesCreatePayload(payload));',
);
assert.doesNotMatch(
  createPhase.tryBody,
  /enqueueVisitPhotos|saveSaleTicketSnapshot/,
  'el try de createSale debe terminar antes de fotos y ticket online',
);

const lockBarrierPhase = tryCatchContaining(
  sale,
  'await persistSaleConfirmationLock(',
);
const offlineSaleIndex = sale.indexOf('if (!isOnline) {');
const payloadIndex = sale.indexOf('const payload = {');
assert(payloadIndex >= 0 && payloadIndex < lockBarrierPhase.tryStart);
assert(
  lockBarrierPhase.catchEnd < offlineSaleIndex,
  'la barrera durable termina antes de cualquier enqueue offline',
);
assert(
  lockBarrierPhase.catchEnd < createPhase.tryStart,
  'la barrera durable termina antes del createSale online',
);
assert.match(
  lockBarrierPhase.tryBody,
  /await persistSaleConfirmationLock\(operationId\)/,
);
assert.match(lockBarrierPhase.tryBody, /if \(!lockPersisted\)/);
const lockFailedFlagIndex = lockBarrierPhase.catchBody.indexOf(
  'setSaleRecoveryPersistenceFailed(true)',
);
const lockFailedSubmittingIndex = lockBarrierPhase.catchBody.indexOf(
  'setSaleSubmitting(false)',
);
assert(
  lockFailedFlagIndex >= 0 && lockFailedFlagIndex < lockFailedSubmittingIndex,
  'el fallo de barrera bloquea recuperación antes de terminar submitting',
);
assert.match(
  lockBarrierPhase.catchBody,
  /logError\(\s*['"]sync['"],\s*['"]sale_confirmation_lock_persist_failed['"],[\s\S]*?operation_id:\s*operationId[\s\S]*?message:/,
);
assert.match(
  lockBarrierPhase.catchBody,
  /safeUnknownErrorMessage\(\s*lockPersistError,/,
);
assert.match(
  lockBarrierPhase.catchBody,
  /Alert\.alert\(\s*['"]Pedido no enviado['"],[\s\S]*?No se envió el pedido[\s\S]*?No cierres la aplicación/,
);
assert.doesNotMatch(
  lockBarrierPhase.catchBody,
  /\benqueue\s*\(|createSale|classifySaleSubmissionError|unlockSaleConfirm|saleConfirmationSingleFlight\.release|router\.|setAfterSaleAction|updateStopState|saveSaleTicketSnapshot/,
  'fallar la barrera no causa side effects de venta, unlock ni navegación',
);
assert.match(lockBarrierPhase.catchBody, /return;/);

assert.match(
  sale,
  /import\s*\{[\s\S]*?classifySaleSubmissionError[\s\S]*?readSaleSubmissionErrorMetadata[\s\S]*?\}\s*from\s*['"]\.\.\/\.\.\/src\/services\/saleSubmissionOutcome['"]/,
  'la pantalla debe importar el clasificador y el lector seguro',
);
assert.match(
  sale,
  /import\s*\{\s*persistAmbiguousSaleRecovery\s*\}\s*from\s*['"]\.\.\/\.\.\/src\/services\/saleAmbiguousRecovery['"]/,
  'la pantalla debe importar la recuperacion ambigua durable',
);
assert.match(
  sale,
  /import\s*\{[^}]*\bsafeUnknownErrorMessage\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/src\/services\/saleConfirmationFlow['"]/,
  'la pantalla debe usar el lector RN-free para errores unknown',
);
assert.match(
  sale,
  /hasQueuedSaleOrderRecoveryEvidence\(\s*saleOperationId,\s*syncQueue,?\s*\)/,
  'la pantalla debe derivar evidencia de la cola ya rehidratada',
);
assert.match(
  sale,
  /shouldResumeAfterSale\(\{[\s\S]*?saleReadyToContinue,[\s\S]*?hasQueuedSaleOrderEvidence:/,
  'la decision de reanudacion recibe el marker durable y la evidencia de cola',
);
const resumeEffect = blockAfter(sale, 'React.useEffect(() =>');
const resumeEffectEnd = sale.indexOf(']);', resumeEffect.closeBraceIndex);
assert.notEqual(resumeEffectEnd, -1, 'el efecto de reanudacion debe cerrar sus dependencias');
const resumeEffectDependencies = sale.slice(resumeEffect.closeBraceIndex + 1, resumeEffectEnd);
assert.match(resumeEffectDependencies, /saleOperationId,/);
assert.match(resumeEffectDependencies, /saleReadyToContinue,/);
assert.match(
  resumeEffectDependencies,
  /hasSaleOrderRecoveryEvidence,/,
  'el efecto debe reevaluar cuando aparece evidencia rehidratada',
);
assert.match(
  sale,
  /import\s*\{[^}]*\blogInfo\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/src\/utils\/logger['"]/,
  'la pantalla debe preservar logInfo',
);
assert.match(
  sale,
  /import\s*\{[^}]*\blogError\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/src\/utils\/logger['"]/,
  'la pantalla debe importar logError',
);
assert.match(
  sale,
  /const persistSaleConfirmationLock\s*=\s*useVisitStore\(\(s\)\s*=>\s*s\.persistSaleConfirmationLock\)/,
  'la pantalla selecciona la barrera durable del lock',
);

assert.match(createPhase.catchBody, /classifySaleSubmissionError\(error\)/);
assert.match(createPhase.catchBody, /readSaleSubmissionErrorMetadata\(error\)/);
assert.doesNotMatch(
  sale,
  /instanceof\s+Error/,
  'ningun catch de la pantalla debe depender del prototipo de un error unknown',
);
assert.equal(
  (sale.match(/classifySaleSubmissionError\(/g) ?? []).length,
  1,
  'solo el catch de createSale debe clasificar el resultado',
);
assert.match(
  createPhase.catchBody,
  /logInfo\(\s*['"]general['"],\s*['"]sale_submission_outcome['"],[\s\S]*?operation_id:\s*operationId[\s\S]*?outcome:\s*outcome\.kind[\s\S]*?http_status:\s*metadata\.httpStatus[\s\S]*?code:\s*metadata\.code/,
  'el resultado remoto debe quedar registrado con metadata segura',
);

const terminalMarkerPhase = tryCatchContaining(
  sale,
  'await markSaleReadyToContinue(',
  createPhase.catchEnd + 1,
);
assert(
  terminalMarkerPhase.tryStart > createPhase.catchEnd,
  'el marker terminal directo tiene un límite de error posterior al createSale',
);
assert.match(
  terminalMarkerPhase.tryBody,
  /await markSaleReadyToContinue\(\s*operationId,\s*\{\s*clearOperationId:\s*true\s*\},?\s*\)/,
  'el éxito directo limpia el operation id dentro del snapshot terminal',
);
assert.match(terminalMarkerPhase.tryBody, /if \(!markedReadyToContinue\)/);
assert.match(terminalMarkerPhase.catchBody, /setSaleRecoveryPersistenceFailed\(true\)/);
assert.match(terminalMarkerPhase.catchBody, /setSaleSubmitting\(false\)/);
assert.match(
  terminalMarkerPhase.catchBody,
  /logError\(\s*['"]sync['"],\s*['"]sale_remote_confirmation_state_persist_failed['"],[\s\S]*?operation_id:\s*operationId[\s\S]*?message:/,
);
assert.match(
  terminalMarkerPhase.catchBody,
  /safeUnknownErrorMessage\(\s*persistError,/,
  'el fallo crítico se registra sin asumir un Error nativo',
);
assert.match(
  terminalMarkerPhase.catchBody,
  /Alert\.alert\(\s*['"]La venta se confirmó['"],[\s\S]*?No cierres la aplicación/,
  'el vendedor recibe una advertencia inequívoca de venta remota confirmada',
);
assert.doesNotMatch(
  terminalMarkerPhase.catchBody,
  /classifySaleSubmissionError|unlockSaleConfirm|router\.|setAfterSaleAction|updateStopState|enqueueVisitPhotos|saveSaleTicketSnapshot/,
  'el fallo del marker no se reclasifica, desbloquea ni navega',
);
assert.match(terminalMarkerPhase.catchBody, /return;/);

const definitive = blockAfter(
  createPhase.catchBody,
  "if (outcome.kind === 'definitive_rejection')",
);
assert.match(definitive.body, /setSaleSubmitting\(false\)/);
assert.match(definitive.body, /unlockSaleConfirm\(\)/);
assert.match(definitive.body, /getInsufficientStockDetail\(error\)/);
assert.match(definitive.body, /describeInsufficientStock\(insufficient\)/);
assert.match(definitive.body, /void loadProducts\(warehouseId\)/);
assert.match(definitive.body, /Alert\.alert\(\s*['"]Venta rechazada['"]/);
assert.match(definitive.body, /return;/);

const recoveryPhase = tryCatchContaining(
  createPhase.catchBody,
  'await persistAmbiguousSaleRecovery({',
);
assert.match(recoveryPhase.tryBody, /operationId,/);
assert.match(recoveryPhase.tryBody, /payload,/);
assert.match(recoveryPhase.tryBody, /customerName:\s*stop\.customer_name/);
assert.match(recoveryPhase.tryBody, /total,/);
assert.match(recoveryPhase.tryBody, /stopId:\s*stop\.id/);
assert.match(recoveryPhase.tryBody, /photoUris:\s*salePhotoUris/);
assert.match(recoveryPhase.tryBody, /enqueue,/);
assert.match(recoveryPhase.tryBody, /persistQueue,/);
assert.match(recoveryPhase.tryBody, /releaseProcessingHolds,/);
assert.match(
  recoveryPhase.catchBody,
  /logError\(\s*['"]sync['"],\s*['"]ambiguous_sale_persist_failed['"],[\s\S]*?operation_id:\s*operationId[\s\S]*?message:/,
);
assert.match(recoveryPhase.catchBody, /setSaleSubmitting\(false\)/);
assert.match(recoveryPhase.catchBody, /safeUnknownErrorMessage\(\s*persistError,/);
const failedFlagIndex = recoveryPhase.catchBody.indexOf('setSaleRecoveryPersistenceFailed(true)');
const failedSubmittingIndex = recoveryPhase.catchBody.indexOf('setSaleSubmitting(false)');
assert(
  failedFlagIndex >= 0 && failedFlagIndex < failedSubmittingIndex,
  'el bloqueo durable se marca antes de terminar el estado submitting',
);
assert.match(
  recoveryPhase.catchBody,
  /Alert\.alert\(\s*['"]No cierres la aplicación['"],\s*['"]No pudimos guardar de forma segura el pedido\. La operación permanece bloqueada; mantén abierta la aplicación e intenta sincronizar nuevamente\.['"],?\s*\)/,
);
assert.doesNotMatch(recoveryPhase.catchBody, /unlockSaleConfirm/);
assert.doesNotMatch(
  recoveryPhase.catchBody,
  /router\.|setAfterSaleAction|updateStopState/,
  'un fallo de persistencia debe retornar antes de cualquier navegacion',
);
assert.match(recoveryPhase.catchBody, /return;/);
assert.match(
  recoveryPhase.tryBody,
  /await persistAmbiguousSaleRecovery\(\{[\s\S]*?setSaleRecoveryPersistenceFailed\(false\)/,
  'la recuperacion durable conserva el flag desbloqueado',
);
assert.doesNotMatch(
  recoveryPhase.catchBody,
  /instanceof\s+Error|\bString\s*\(/,
  'el error de persistencia unknown no debe inspeccionarse de forma insegura',
);

const recoveryCallIndex = createPhase.catchBody.indexOf('await persistAmbiguousSaleRecovery({');
const processQueueIndex = createPhase.catchBody.indexOf('void processQueue().catch', recoveryCallIndex);
assert(
  processQueueIndex > recoveryPhase.tryEnd,
  'processQueue solo puede arrancar despues de esperar la persistencia durable',
);
assert.doesNotMatch(recoveryPhase.tryBody, /processQueue/);
assert.doesNotMatch(
  createPhase.catchBody.slice(0, recoveryPhase.tryStart),
  /\bprocessQueue\s*\(/,
  'processQueue no debe arrancar antes de la recuperacion durable',
);
assert.match(
  createPhase.catchBody.slice(processQueueIndex),
  /ambiguous_sale_process_start_failed[\s\S]*?operation_id:\s*operationId[\s\S]*?message:/,
);
assert.match(
  createPhase.catchBody.slice(processQueueIndex),
  /safeUnknownErrorMessage\(\s*processError,/,
);

const ambiguousSuccess = createPhase.catchBody.slice(recoveryPhase.catchEnd + 1);
assert.match(ambiguousSuccess, /saleOperationId:\s*operationId/);
assert.match(
  ambiguousSuccess,
  /buildSaleTicketSnapshot\(\{[\s\S]*?saleId:\s*operationId/,
  'ticket ambiguo usa el identificador original',
);
assert.match(
  ambiguousSuccess,
  /No pudimos confirmar la respuesta del servidor\. El pedido quedó pendiente de verificación y se reintentará con el mismo identificador\./,
);
assert.match(ambiguousSuccess, /shouldSkipStopCheckout\(stop\.id\)/);
assert.match(ambiguousSuccess, /setAfterSaleAction\(['"]route['"]\)/);
assert.match(ambiguousSuccess, /setAfterSaleAction\(['"]checkout['"]\)/);
assert.match(ambiguousSuccess, /return;/);

const ambiguousTicket = tryCatchContaining(
  createPhase.catchBody,
  'await saveSaleTicketSnapshot(buildSaleTicketSnapshot({',
);
assert.match(
  ambiguousTicket.catchBody,
  /logError\(\s*['"]sync['"],\s*['"]ambiguous_sale_ticket_failed['"],[\s\S]*?operation_id:\s*operationId/,
);
assert.match(ambiguousTicket.catchBody, /Alert\.alert\(/);
assert.match(ambiguousTicket.catchBody, /safeUnknownErrorMessage\(\s*ticketError,/);
assert.doesNotMatch(
  ambiguousTicket.catchBody,
  /unlockSaleConfirm|enqueue\(\s*['"]sale_order['"]|return;|instanceof\s+Error|\bString\s*\(/,
  'fallar el ticket ambiguo no desbloquea, reencola ni evita la ruta pendiente',
);

const postConfirmationNeedleIndex = sale.indexOf(
  'enqueueVisitPhotos({',
  createPhase.catchEnd + 1,
);
assert.notEqual(
  postConfirmationNeedleIndex,
  -1,
  'las fotos online deben procesarse despues del exito de createSale',
);
const postConfirmation = tryCatchContaining(
  sale,
  'enqueueVisitPhotos({',
  createPhase.catchEnd + 1,
);
assert(postConfirmation.tryStart > createPhase.catchEnd);
assert(postConfirmation.tryStart > terminalMarkerPhase.catchEnd);
assert.match(postConfirmation.tryBody, /saveSaleTicketSnapshot/);
assert.match(
  postConfirmation.catchBody,
  /logError\(\s*['"]sync['"],\s*['"]sale_post_confirmation_failed['"],[\s\S]*?operation_id:\s*operationId[\s\S]*?message(?:\s*:|\s*,)/,
);
assert.match(
  postConfirmation.catchBody,
  /Alert\.alert\([\s\S]*?['"`]La venta se confirmó/,
  'la advertencia post-confirmacion debe dejar claro que la venta ya existe',
);
assert.match(postConfirmation.catchBody, /safeUnknownErrorMessage\(\s*error,/);
assert.doesNotMatch(postConfirmation.catchBody, /unlockSaleConfirm|enqueue\(\s*['"]sale_order['"]/);
assert.match(
  sale.slice(postConfirmation.catchEnd + 1),
  /shouldSkipStopCheckout\(stop\.id\)[\s\S]*?setAfterSaleAction/,
  'un fallo post-confirmacion no debe impedir continuar a checkout/ruta',
);
assert.doesNotMatch(
  sale,
  /useVisitStore\.setState\(\{\s*saleOperationId:\s*null\s*\}\)/,
  'el operation id directo sólo se limpia dentro de la transición durable',
);

const pricelistPhase = tryCatchContaining(
  sale,
  'await getPartnerPricelistId(salePartnerId, { companyId: effectiveCompanyId });',
);
assert.match(pricelistPhase.catchBody, /safeUnknownErrorMessage\(\s*error,/);
assert.match(
  pricelistPhase.catchBody,
  /saleConfirmationSingleFlight\.release\(\);\s*unlockSaleConfirm\(\);/,
);

const offrouteClosePhase = tryCatchContaining(
  sale,
  'await closeOffrouteVisit({',
);
assert.match(offrouteClosePhase.catchBody, /safeUnknownErrorMessage\(\s*error,/);

// Selectores necesarios para persistir el lote retenido y luego iniciar sync.
assert.match(sale, /const persistQueue\s*=\s*useSyncStore\(\(s\)\s*=>\s*s\.persistQueue\)/);
assert.match(sale, /const processQueue\s*=\s*useSyncStore\(\(s\)\s*=>\s*s\.processQueue\)/);
assert.match(sale, /const releaseProcessingHolds\s*=\s*useSyncStore\(\(s\)\s*=>\s*s\.releaseProcessingHolds\)/);
assert.match(sale, /const saleRecoveryPersistenceFailed\s*=\s*useVisitStore\(\(s\)\s*=>\s*s\.saleRecoveryPersistenceFailed\)/);
assert.match(
  sale,
  /const setSaleRecoveryPersistenceFailed\s*=\s*useVisitStore\(\s*\(s\)\s*=>\s*s\.setSaleRecoveryPersistenceFailed,?\s*\)/,
);

console.log('sale ambiguous recovery wiring tests: ok');
