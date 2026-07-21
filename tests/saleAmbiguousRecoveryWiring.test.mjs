import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sale = readFileSync(
  resolve(process.cwd(), 'app/sale/[stopId].tsx'),
  'utf8',
);

function matchingBrace(source, openBraceIndex) {
  assert.equal(source[openBraceIndex], '{', 'el extractor debe iniciar en una llave');

  let depth = 0;
  let state = 'code';
  const templateExpressionReturnDepths = [];

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (state === 'single_quote' || state === 'double_quote') {
      if (character === '\\') {
        index += 1;
      } else if (
        (state === 'single_quote' && character === "'")
        || (state === 'double_quote' && character === '"')
      ) {
        state = 'code';
      }
      continue;
    }

    if (state === 'line_comment') {
      if (character === '\n' || character === '\r') state = 'code';
      continue;
    }

    if (state === 'block_comment') {
      if (character === '*' && nextCharacter === '/') {
        state = 'code';
        index += 1;
      }
      continue;
    }

    if (state === 'template') {
      if (character === '\\') {
        index += 1;
      } else if (character === '`') {
        state = 'code';
      } else if (character === '$' && nextCharacter === '{') {
        templateExpressionReturnDepths.push(depth);
        depth += 1;
        state = 'code';
        index += 1;
      }
      continue;
    }

    if (character === "'") {
      state = 'single_quote';
      continue;
    }
    if (character === '"') {
      state = 'double_quote';
      continue;
    }
    if (character === '`') {
      state = 'template';
      continue;
    }
    if (character === '/' && nextCharacter === '/') {
      state = 'line_comment';
      index += 1;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      state = 'block_comment';
      index += 1;
      continue;
    }
    if (character === '{') {
      depth += 1;
      continue;
    }
    if (character === '}') {
      depth -= 1;
      if (templateExpressionReturnDepths.at(-1) === depth) {
        templateExpressionReturnDepths.pop();
        state = 'template';
        continue;
      }
      if (depth === 0) return index;
    }
  }

  throw new Error(`bloque sin cierre desde ${openBraceIndex}`);
}

const lexicalBraceFixture = [
  '{',
  '  const stringValue = "}";',
  '  // } must not close the block',
  '  /* } must not close the block either */',
  '  const templateValue = `template } ${(() => ({ nested: true }))()} tail`;',
  '}',
].join('\n');
assert.equal(
  matchingBrace(lexicalBraceFixture, 0),
  lexicalBraceFixture.length - 1,
  'el scanner ignora llaves en strings, comentarios y texto template, pero cuenta expresiones template',
);

function blockAfter(source, marker, fromIndex = 0) {
  const markerIndex = source.indexOf(marker, fromIndex);
  assert.notEqual(markerIndex, -1, `no se encontro el marcador: ${marker}`);
  const openBraceIndex = source.indexOf('{', markerIndex + marker.length);
  assert.notEqual(openBraceIndex, -1, `no se encontro el bloque de: ${marker}`);
  const closeBraceIndex = matchingBrace(source, openBraceIndex);
  return {
    markerIndex,
    openBraceIndex,
    closeBraceIndex,
    body: source.slice(openBraceIndex + 1, closeBraceIndex),
  };
}

function tryCatchContaining(source, needle, fromIndex = 0) {
  const needleIndex = source.indexOf(needle, fromIndex);
  assert.notEqual(needleIndex, -1, `no se encontro la operacion: ${needle}`);

  const candidates = [];
  const tryPattern = /\btry\s*\{/g;
  let match;
  while ((match = tryPattern.exec(source)) !== null) {
    const openBraceIndex = source.indexOf('{', match.index);
    const closeBraceIndex = matchingBrace(source, openBraceIndex);
    if (openBraceIndex < needleIndex && needleIndex < closeBraceIndex) {
      candidates.push({ markerIndex: match.index, openBraceIndex, closeBraceIndex });
    }
  }

  assert(candidates.length > 0, `${needle} debe estar dentro de un try`);
  const tryBlock = candidates.at(-1);
  const afterTry = source.slice(tryBlock.closeBraceIndex + 1);
  const catchMatch = afterTry.match(/^\s*catch\s*\([^)]*\)\s*\{/);
  assert(catchMatch, `el try de ${needle} debe tener catch inmediato`);
  const catchOpenBraceIndex = tryBlock.closeBraceIndex + 1 + catchMatch.index
    + catchMatch[0].lastIndexOf('{');
  const catchCloseBraceIndex = matchingBrace(source, catchOpenBraceIndex);

  return {
    needleIndex,
    tryStart: tryBlock.markerIndex,
    tryEnd: tryBlock.closeBraceIndex,
    tryBody: source.slice(tryBlock.openBraceIndex + 1, tryBlock.closeBraceIndex),
    catchStart: catchOpenBraceIndex,
    catchEnd: catchCloseBraceIndex,
    catchBody: source.slice(catchOpenBraceIndex + 1, catchCloseBraceIndex),
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
  /shouldResumeAfterSale\(\{[\s\S]*?saleOperationId,[\s\S]*?hasQueuedSaleOrderEvidence:/,
  'la decision de reanudacion recibe el operationId y la evidencia de cola',
);
const resumeEffect = blockAfter(sale, 'React.useEffect(() =>');
const resumeEffectEnd = sale.indexOf(']);', resumeEffect.closeBraceIndex);
assert.notEqual(resumeEffectEnd, -1, 'el efecto de reanudacion debe cerrar sus dependencias');
const resumeEffectDependencies = sale.slice(resumeEffect.closeBraceIndex + 1, resumeEffectEnd);
assert.match(resumeEffectDependencies, /saleOperationId,/);
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
