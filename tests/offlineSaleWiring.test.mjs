import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

function extractBracedBlockAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `no se encontro el marcador: ${marker}`);

  const openBraceIndex = source.indexOf('{', markerIndex + marker.length);
  assert.notEqual(openBraceIndex, -1, `no se encontro el bloque de: ${marker}`);

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex + 1, index);
    }
  }

  throw new Error(`bloque sin cierre para: ${marker}`);
}

/**
 * Wiring de venta offline (modelo "pedido pendiente de envío", S1):
 *  #1 ProductPicker no cuelga sin red; #2 online sigue siendo createSale directo;
 *  #3 offline ENCOLA sale_order (+ foto) sin marcar confirmada; #5 insufficient_stock.
 */
const root = process.cwd();
const picker = fs.readFileSync(path.join(root, 'src/components/domain/ProductPicker.tsx'), 'utf8');
const sale = fs.readFileSync(path.join(root, 'app/sale/[stopId].tsx'), 'utf8');
const visitStore = fs.readFileSync(path.join(root, 'src/stores/useVisitStore.ts'), 'utf8');

// PR-4a: la confirmación offline decide la tarifa solo con datos locales.
assert(
  sale.includes("from '../../src/services/salePricelistDecision'"),
  'venta debe importar la decisión pura de tarifa',
);
assert.match(
  sale,
  /const pricelistDecision = decideSalePricelist\(\{[\s\S]*?isOnline:\s*confirmationIsOnline,[\s\S]*?stopPricelistId,[\s\S]*?cachedPricelistId,[\s\S]*?\}\);/,
  'venta debe decidir con conectividad, tarifa de parada y cache local',
);
const resolverGuardBody = extractBracedBlockAfter(
  sale,
  'if (pricelistDecision.shouldResolvePartnerPricelist)',
);
const resolverCalls = sale.match(/\bgetPartnerPricelistId\s*\(/g) ?? [];
assert.equal(
  resolverCalls.length,
  1,
  'debe existir una sola llamada al resolvedor de tarifa',
);
assert.equal(
  (resolverGuardBody.match(/\bgetPartnerPricelistId\s*\(/g) ?? []).length,
  1,
  'la unica llamada al resolvedor debe quedar dentro del guard de la decision',
);
assert.match(
  resolverGuardBody,
  /\bawait\s+getPartnerPricelistId\([\s\S]*?const resolvedPricelistId = peekResolvedPartnerPricelistId\([\s\S]*?pricelistId =/,
  'online debe releer la tarifa segura de cache despues de resolver',
);

// #1 ProductPicker: guard isOnline antes del fetch de precios (no cuelga offline).
assert(picker.includes('useSyncStore'), 'ProductPicker debe leer isOnline');
assert(/if \(!isOnline\)/.test(picker), 'price effect debe cortar el fetch si !isOnline');

// Snapshot de precio offline: identidad exacta y decisión pura para cada producto.
assert(
  picker.includes('getCustomerPricingSnapshotState')
    && picker.includes('resolveCapturedCustomerPrice')
    && picker.includes('selectProductPrice'),
  'ProductPicker debe resolver y seleccionar el snapshot offline con servicios puros',
);
assert(
  picker.includes('useRouteStore'),
  'ProductPicker debe leer el plan actual para distinguir prepared de last-known',
);
assert.match(
  picker,
  /resolveCapturedCustomerPrice\(\s*getCustomerPricingSnapshotState\(\),\s*\{[\s\S]*?companyId:\s*resolvedCompanyId,[\s\S]*?planId,[\s\S]*?partnerId:\s*resolvedPartnerId,[\s\S]*?requestedPricelistId:\s*pricelistId\s*\?\?\s*null,[\s\S]*?productId:\s*p\.id,[\s\S]*?publicPrice:\s*p\.list_price,[\s\S]*?\}\s*\)/,
  'offline debe resolver por empresa, plan, cliente, lista solicitada, producto y precio publico exactos',
);
assert.match(
  picker,
  /const priceSelection = selectProductPrice\(\{[\s\S]*?isOnline,[\s\S]*?snapshotPrice,[\s\S]*?publicPrice:\s*p\.list_price,[\s\S]*?\}\)/,
  'cada producto debe pasar por la decisión pura de precio',
);

// Catálogo offline 3/3: conectividad y autoridad de inventario son entradas
// separadas. Online nunca cae al bypass por tener caché viejo.
assert(
  sale.includes("from '../../src/services/saleStockEnforcement'"),
  'venta debe importar la decisión pura de enforcement de inventario',
);
assert(
  sale.includes('isApplicableAuthoritativeSaleInventory')
    && sale.includes('isApplicableSaleSubmissionContext')
    && sale.includes('isSameSaleConfirmationContext'),
  'venta debe ligar refresh y confirmación al contexto exacto',
);
assert.match(
  sale,
  /const activeVisitStop = visit\.currentStop;[\s\S]*?activeVisitStopId:\s*visit\.currentStopId[\s\S]*?activeVisitCurrentStopId:\s*activeVisitStop\?\.id\s*\?\?\s*null[\s\S]*?activeVisitPartnerId/,
  'el contexto vivo debe incluir currentStopId y currentStop de la visita activa',
);
assert.match(
  sale,
  /const saleStockEnforcement = decideSaleStockEnforcement\(\{[\s\S]*?isOnline,[\s\S]*?policy:\s*'offline_sale',[\s\S]*?inventoryFreshness,[\s\S]*?\}\);/,
  'la pantalla debe decidir con conectividad real, política opt-in y autoridad separadas',
);
assert.match(
  sale,
  /const onlineInventoryReady = [^;]*saleStockEnforcement\.allowConfirm[^;]*;/,
  'debe derivar una sola bandera de readiness online desde la decisión pura',
);
assert.match(
  sale,
  /const refreshInventoryAuthority = React\.useCallback\([\s\S]*?expectedContext:[\s\S]*?const inventoryLoadResult = await loadProductsAuthoritative\(expectedContext\.warehouseId\)[\s\S]*?isApplicableAuthoritativeSaleInventory\(\{[\s\S]*?loadResult:\s*inventoryLoadResult/,
  'el refresh debe conservar y validar el resultado autoritativo contra su contexto capturado',
);
assert.match(
  sale,
  /React\.useEffect\(\(\) => \{[\s\S]*?saleStockEnforcement\.shouldRefresh[\s\S]*?readLiveSaleConfirmationContext\([\s\S]*?refreshInventoryAuthority\(refreshContext\)/,
  'volver online con inventario no autoritativo debe disparar refresh coalescido',
);
assert.match(
  sale,
  /useFocusEffect\([\s\S]*?shouldRefreshProductsOnFocus\([\s\S]*?\) && isOnline\)[\s\S]*?loadProductsAuthoritative\(warehouseId!\)/,
  'el refresh por foco debe compartir la API autoritativa coalescida y no duplicar transporte',
);

// La línea congela precio y procedencia; los snapshots legacy siguen siendo válidos.
assert.match(visitStore, /priceSource\?:\s*'prepared_customer'\s*\|\s*'last_known_customer'\s*\|\s*'public_fallback'/);
assert.match(visitStore, /priceCapturedAtMs\?:\s*number\s*\|\s*null/);
assert.match(visitStore, /pricelistId\?:\s*number\s*\|\s*null/);
assert.match(
  picker,
  /price:\s*normalizeSaleLineBasePrice\(product\.priceSelection\.price\.unitPrice\)/,
  'la línea debe usar exactamente el precio capturado por la decisión',
);
assert.match(
  picker,
  /priceSource:\s*product\.priceSelection\.price\.source[\s\S]*?priceCapturedAtMs:\s*product\.priceSelection\.price\.capturedAtMs[\s\S]*?pricelistId:\s*product\.priceSelection\.price\.pricelistId/,
  'la línea debe conservar procedencia, captura y lista canónica',
);
assert(
  picker.includes('decideProductSelectionReadiness')
    && picker.includes('publishedPricingContextKey')
    && picker.includes('currentPricingContextKey'),
  'la selección debe usar readiness pura ligada al contexto exacto publicado',
);
assert.match(
  picker,
  /const handleSelect = useCallback\([\s\S]*?if \(!selectionReadiness\.canSelect\) return;[\s\S]*?const line: SaleLineItem/,
  'handleSelect debe cortar sin construir línea mientras falta precio cliente exacto',
);
assert.equal(
  (picker.match(/outOfStock \|\| alreadyAdded \|\| !selectionReadiness\.canSelect/g) ?? []).length,
  2,
  'lista y grid deben deshabilitar su acción mientras esperan precio cliente',
);
assert(
  picker.includes('Esperando precio del cliente'),
  'el picker debe explicar claramente por qué las acciones están deshabilitadas',
);

// Sólo public_fallback offline envuelve el add/close existente en una alerta.
assert.match(
  picker,
  /if \(product\.priceSelection\.requiresPublicFallbackConfirmation\) \{[\s\S]*?Alert\.alert\([\s\S]*?precio del cliente guardado[\s\S]*?precio público[\s\S]*?text:\s*'Cancelar'[\s\S]*?style:\s*'cancel'[\s\S]*?text:\s*'Usar precio público'[\s\S]*?onPress:\s*confirmPending/,
  'fallback público debe pedir una confirmación cancelable antes de agregar',
);
assert.equal(
  (picker.match(/\bonAddLine\(line\)/g) ?? []).length,
  1,
  'la confirmación debe conservar un solo sink onAddLine',
);
assert.equal(
  (picker.match(/\baddSaleLine\(line\)/g) ?? []).length,
  1,
  'la confirmación debe conservar un solo sink addSaleLine',
);
assert(
  picker.includes('pendingPublicFallbackRef')
    && picker.includes('if (pendingPublicFallbackRef.current) return'),
  'fallback público debe bloquear taps repetidos mientras la alerta está abierta',
);
assert.match(
  picker,
  /if \([\s\S]*?pending\.committed[\s\S]*?\|\| pendingPublicFallbackRef\.current !== pending[\s\S]*?\|\| selectionContextKeyRef\.current !== pending\.contextKey[\s\S]*?\) return;[\s\S]*?pending\.committed = true/,
  'confirmar fallback debe ser idempotente y exigir la selección todavía vigente',
);
assert.match(
  picker,
  /text:\s*'Cancelar'[\s\S]*?onPress:\s*clearPending[\s\S]*?onPress:\s*confirmPending[\s\S]*?onDismiss:\s*clearPending/,
  'cancelar, confirmar o cerrar la alerta debe limpiar el guard local',
);
assert(
  picker.includes('createProductSelectionCommitGuard')
    && picker.includes('selectionCommitGuard.begin(')
    && picker.includes('selectionCommitGuard.commit('),
  'todos los caminos de add deben compartir un guard de commit idempotente',
);
assert.match(
  picker,
  /const commitSelection = \(\) => \{[\s\S]*?selectionContextKeyRef\.current !== selectionCommit\.contextKey[\s\S]*?selectionCommitGuard\.commit\([\s\S]*?onAddLine\(line\)[\s\S]*?addSaleLine\(line\)/,
  'el commit general debe validar contexto y envolver ambos sinks exactamente una vez',
);
assert.match(
  picker,
  /const clearPending = \(\) => \{[\s\S]*?selectionCommitGuard\.cancel\(pending\.selectionCommit\)/,
  'cancelar el fallback debe liberar el intento general no confirmado',
);
assert.match(
  picker,
  /const closePicker = useCallback\(\(\) => \{[\s\S]*?selectionCommitGuard\.cancelUncommitted\(\)[\s\S]*?onClose\(\)/,
  'cerrar sin commit debe liberar el guard general',
);

// Un full response online alimenta display + ledger; nunca activa preparación.
assert(
  picker.includes('fetchServerCustomerPricingSnapshot')
    && picker.includes('recordLastKnownServerPrices')
    && picker.includes('updateCustomerPricingSnapshotState'),
  'ProductPicker online debe usar el contrato full y publicar el ledger',
);
assert.equal(
  (picker.match(/\bfetchServerCustomerPricingSnapshot\s*\(/g) ?? []).length,
  1,
  'un loader compartido debe realizar una sola petición full por carga',
);
assert.match(
  picker,
  /const validation = await fetchFullCustomerPricingOnce\([\s\S]*?const displayPrices = new Map\(validation\.prices\)[\s\S]*?updateCustomerPricingSnapshotState\(\(current\) =>[\s\S]*?recordLastKnownServerPrices\(current,[\s\S]*?validation,[\s\S]*?\)\s*\)/,
  'la misma respuesta completa debe alimentar display y recordLastKnownServerPrices',
);
assert(
  picker.includes('const requestToken = requestGate.begin(')
    && /nextForegroundPricingCapture\([\s\S]*?maxCustomerPricingCaptureAtMs\([\s\S]*?getCustomerPricingSnapshotState\(\)/.test(picker)
    && /loadOnlineCustomerPricing\(\{[\s\S]*?requestToken,[\s\S]*?requestGate,/.test(picker),
  'la captura foreground debe asignarse al iniciar la petición y viajar con su token',
);
assert.match(
  picker,
  /if \(!input\.requestGate\.isCurrent\(input\.requestToken\)\) \{[\s\S]*?return staleCustomerPricingResult\(\);[\s\S]*?\}[\s\S]*?updateCustomerPricingSnapshotState/,
  'una respuesta obsoleta no debe alcanzar la escritura del ledger',
);
assert.match(
  picker,
  /runCommitIfCurrent\(\s*input\.requestToken,\s*async \(\) => \{[\s\S]*?await updateCustomerPricingSnapshotState\([\s\S]*?\},\s*\)/,
  'la aceptación del token debe abarcar saveStrict y publicación del ledger',
);
assert.match(
  picker,
  /await input\.requestGate\.waitUntilCurrent\(input\.requestToken\)/,
  'una petición en espera debe activarse después del commit durable anterior',
);
assert.match(
  picker,
  /requestGate\.isCurrent\(requestToken\)[\s\S]*?pricingContextKeyRef\.current === requestToken\.contextKey[\s\S]*?selectionContextKeyRef\.current === requestSelectionContextKey[\s\S]*?setPriceMap\(loaded\.displayPrices\)[\s\S]*?setOnlineCapturedPrices\(loaded\.capturedPrices\)/,
  'una respuesta obsoleta no debe publicar precios en UI tras cambio exacto de contexto',
);
assert(
  picker.includes('createLatestProductPricingRequestGate')
    && picker.includes('requestGate.cancel(requestToken)'),
  'efecto y refresh deben compartir una compuerta latest-request-wins cancelable',
);
assert.match(
  picker,
  /const closePicker = useCallback\(\(\) => \{[\s\S]*?requestGate\.invalidate\(\)[\s\S]*?pendingPublicFallbackRef\.current = null[\s\S]*?onClose\(\)/,
  'cerrar el picker debe invalidar inmediatamente requests y confirmaciones pendientes',
);
assert(
  picker.includes('computeCustomerPricesClientFallback')
    && !picker.includes('computeCustomerPrices('),
  'tras fallar el full response debe usar fallback client-only sin repetir el endpoint estricto',
);
assert(
  !picker.includes('activatePreparedPricingRun'),
  'ProductPicker nunca debe activar un manifiesto preparado',
);

// #2 ONLINE: venta sigue siendo online-first (createSale directo).
assert(sale.includes('await createSale('), 'venta online usa createSale directo');

// #3 OFFLINE (S1): el pedido se ENCOLA como sale_order (+ foto) y NO se confirma
// offline. La rama offline va DESPUÉS de construir el payload (no antes de lock).
assert.match(
  sale,
  /if \(confirmationIsOnline === false\) \{[\s\S]*?await persistAmbiguousSaleRecovery\(\{[\s\S]*?operationId:\s*recoveryIntent\.operationId/,
  'offline debe materializar durablemente el intent con el mismo operationId',
);
assert.doesNotMatch(
  sale,
  /useVisitStore\.setState\(\{\s*saleOperationId:\s*enqId\s*\}\)/,
  'offline no corrige el operationId sólo en memoria después de encolar',
);
assert(sale.includes('persistAmbiguousSaleRecovery'), 'venta debe usar el lote durable compartido para pedido y evidencia');
assert(!sale.includes('salePhotoUris[0]'), 'venta debe encolar todas las fotos capturadas, no solo la primera');
const offlineIdx = sale.indexOf('if (confirmationIsOnline === false) {');
const createIdx = sale.indexOf('await createSale(');
assert(offlineIdx > -1 && createIdx > -1 && offlineIdx < createIdx,
  'la rama offline (enqueue) va antes del createSale online');
const offlineBranch = extractBracedBlockAfter(
  sale,
  'if (confirmationIsOnline === false)',
);
const offlineTicketSaveIndex = offlineBranch.indexOf(
  'await saveSaleTicketSnapshot(recoveryIntent.ticketSnapshot)',
);
assert(offlineTicketSaveIndex >= 0, 'offline intenta guardar el comprobante del intent durable');
const offlineRecoveryPersistIndex = offlineBranch.indexOf(
  'await persistAmbiguousSaleRecovery({',
);
assert(
  offlineRecoveryPersistIndex > offlineTicketSaveIndex,
  'offline guarda el ticket pendiente antes de persistir y liberar la cola',
);
const offlineTicketTryIndex = offlineBranch.lastIndexOf('try {', offlineTicketSaveIndex);
const offlineTicketCatchIndex = offlineBranch.indexOf('catch (ticketError)', offlineTicketSaveIndex);
assert(
  offlineTicketTryIndex >= 0 && offlineTicketTryIndex < offlineTicketSaveIndex,
  'el guardado estricto del ticket offline queda dentro de su propio try',
);
assert(
  offlineTicketCatchIndex > offlineTicketSaveIndex,
  'el guardado estricto del ticket offline tiene un catch explícito',
);
const offlineTicketCatch = extractBracedBlockAfter(offlineBranch, 'catch (ticketError)');
assert.match(
  offlineTicketCatch,
  /setSaleRecoveryPersistenceFailed\(true\)[\s\S]*?setSaleSubmitting\(false\)/,
  'fallar el ticket conserva el bloqueo durable antes de terminar submitting',
);
assert.match(
  offlineTicketCatch,
  /logError\(\s*['"]sync['"],\s*['"]offline_sale_ticket_persist_failed['"],[\s\S]*?operation_id:\s*operationId[\s\S]*?message:/,
  'el fallo del ticket offline queda registrado con operation_id y mensaje seguro',
);
assert.match(
  offlineTicketCatch,
  /safeUnknownErrorMessage\(\s*ticketError,/,
  'el log del ticket offline sanitiza errores unknown',
);
assert.match(
  offlineTicketCatch,
  /Alert\.alert\([\s\S]*?comprobante local[\s\S]*?operación permanece bloqueada[\s\S]*?recuperará/,
  'el aviso explica el fallo estricto y la recuperación durable',
);
assert.doesNotMatch(
  offlineTicketCatch,
  /Pedido guardado|quedó guardado en la cola|se enviará al reconectar/,
  'el fallo anterior al enqueue no puede afirmar que el pedido ya está en la cola',
);
assert.match(offlineTicketCatch, /return;/);
assert.doesNotMatch(
  offlineTicketCatch,
  /unlockSaleConfirm|saleConfirmationSingleFlight\.release|setLastSaleTicketId|setAfterSaleAction|updateStopState|markSaleReadyToContinue|clearSaleConfirmationLock/,
  'fallar el ticket no desbloquea ni marca éxito de ruta/checkout',
);
assert(/const saleResult = await createSale\(buildSalesCreatePayload\(payload\)\)[\s\S]*?enqueueVisitPhotos/.test(sale),
  'online: despues de crear venta en Odoo debe encolar la evidencia para subirla');

const confirmBody = extractBracedBlockAfter(sale, 'async function handleConfirm()');
const synchronousInputLockIdx = confirmBody.indexOf(
  'if (!saleConfirmationSingleFlight.tryAcquire()) return;',
);
const confirmationInputCaptureIdx = confirmBody.indexOf(
  'const confirmationInput = readLiveSaleSubmissionInput();',
);
assert(
  synchronousInputLockIdx >= 0
    && synchronousInputLockIdx < confirmationInputCaptureIdx
    && synchronousInputLockIdx < confirmBody.indexOf('await '),
  'handleConfirm debe tomar el lock síncrono antes del snapshot y del primer await',
);
assert.match(
  confirmBody,
  /const confirmationContext = readLiveSaleConfirmationContext\(stop\.id\);[\s\S]*?const confirmationInput = readLiveSaleSubmissionInput\(\);[\s\S]*?const confirmationIsOnline = confirmationContext\.isOnline;/,
  'handleConfirm debe capturar contexto y entrada de venta vivos una sola vez al inicio',
);
const authorityGuardIdx = confirmBody.indexOf('if (!liveStockEnforcement.allowConfirm)');
const quantityGuardIdx = confirmBody.indexOf('if (quantityIssues.length > 0)');
const freshStockGuardIdx = confirmBody.indexOf('findFreshStockIssues(');
assert(
  authorityGuardIdx >= 0
    && quantityGuardIdx > authorityGuardIdx
    && freshStockGuardIdx > authorityGuardIdx,
  'handleConfirm debe resolver autoridad antes de validar cantidades o stock fresco',
);
assert.match(
  confirmBody,
  /await refreshInventoryAuthority\(confirmationContext\);[\s\S]*?isLiveSaleSubmissionContextApplicable\(confirmationContext, confirmationInput\)[\s\S]*?liveStockEnforcement = decideSaleStockEnforcement/,
  'después del refresh debe releer conectividad y autoridad vivas antes de continuar',
);
assert.match(
  confirmBody,
  /findSaleQuantityIssues\(confirmationInput\.saleLines\)/,
  'la primera barrera debe validar sólo integridad de cantidades del snapshot',
);
assert.doesNotMatch(
  confirmBody,
  /getStockIssues\(/,
  'la confirmación no debe comparar contra line.stock capturado antes del stock fresco',
);
assert.match(
  confirmBody,
  /findFreshStockIssues\(confirmationInput\.saleLines,\s*useProductStore\.getState\(\)\.products\)/,
  'el inventario autoritativo recién cargado debe ser la única barrera online de stock',
);
assert.match(
  confirmBody,
  /decideSalePricelist\(\{[\s\S]*?isOnline:\s*confirmationIsOnline,/,
  'la tarifa debe usar la conectividad capturada y validada',
);
assert.match(
  confirmBody,
  /if \(confirmationIsOnline === false\) \{/,
  'la rama durable offline debe usar la misma conectividad capturada que la tarifa',
);
const pricingAwaitIdx = confirmBody.indexOf('await getPartnerPricelistId(');
const lockPersistIdx = confirmBody.indexOf('await persistSaleConfirmationLock(');
const branchIdx = confirmBody.indexOf('if (confirmationIsOnline === false)');
const guardAfterPricingIdx = confirmBody.indexOf(
  'if (!isLiveSaleSubmissionContextApplicable(confirmationContext, confirmationInput))',
  pricingAwaitIdx,
);
const guardAfterLockIdx = confirmBody.indexOf(
  'if (!isLiveSaleSubmissionContextApplicable(confirmationContext, confirmationInput))',
  lockPersistIdx,
);
assert(
  pricingAwaitIdx >= 0
    && guardAfterPricingIdx > pricingAwaitIdx
    && lockPersistIdx > guardAfterPricingIdx,
  'un cambio durante pricing debe abortar antes de persistir el lock',
);
const preLockGuard = confirmBody.slice(guardAfterPricingIdx, lockPersistIdx);
assert.match(
  preLockGuard,
  /releaseSaleInputMutationLock\(\)[\s\S]*?unlockSaleConfirm\(\)[\s\S]*?return;/,
  'si cae autoridad durante pricing debe abortar y liberar sólo el lock aún no durable',
);
assert.doesNotMatch(
  preLockGuard,
  /persistAmbiguousSaleRecovery|createSale\(|recordRecentProducts/,
  'un fallo de autoridad durante pricing no debe enviar, encolar ni registrar recientes',
);
assert(
  guardAfterLockIdx > lockPersistIdx
    && branchIdx > guardAfterLockIdx,
  'el contexto debe revalidarse inmediatamente antes de elegir queue o createSale',
);
const postLockGuard = confirmBody.slice(guardAfterLockIdx, branchIdx);
assert.match(
  postLockGuard,
  /await clearSaleConfirmationLock\(operationId\)/,
  'un cambio después del lock durable debe limpiarlo estrictamente antes de permitir reintento',
);
assert.match(
  postLockGuard,
  /if \(!cleared\)[\s\S]*?setSaleRecoveryPersistenceFailed\(true\)[\s\S]*?return;/,
  'si el cleanup durable falla debe conservar el recovery bloqueado y no enviar ni encolar',
);
assert.doesNotMatch(
  postLockGuard,
  /persistAmbiguousSaleRecovery|createSale\(|recordRecentProducts/,
  'un fallo de autoridad tras el lock no debe enviar, encolar ni registrar recientes',
);
assert.match(
  sale,
  /function readLiveSaleSubmissionInput\(\)[\s\S]*?useVisitStore\.getState\(\)[\s\S]*?captureSaleSubmissionInput\(\{[\s\S]*?saleLines:[\s\S]*?salePaymentMethod:[\s\S]*?salePhotoTaken:[\s\S]*?salePhotoUri:[\s\S]*?salePhotoUris:/,
  'el snapshot debe salir del estado vivo e incluir carrito, pago y toda la evidencia',
);
assert.match(
  confirmBody,
  /payment_method:\s*confirmedPaymentMethod[\s\S]*?lines:\s*confirmationInput\.saleLines\.map/,
  'el payload debe usar pago y líneas del snapshot capturado',
);
assert.match(
  confirmBody,
  /buildSaleTicketSnapshot\(\{[\s\S]*?lines:\s*confirmationInput\.saleLines\.map/,
  'el ticket debe usar líneas del mismo snapshot',
);
assert.match(
  confirmBody,
  /photoUris:\s*\[\.\.\.confirmationInput\.salePhotoUris\][\s\S]*?recordRecentProducts\(confirmationInput\.saleLines\.map/,
  'recovery y recientes deben reutilizar el snapshot inmutable',
);
assert.match(
  sale,
  /const saleInputsLocked\s*=\s*saleSubmitting\s*\|\|\s*saleConfirmed\s*\|\|\s*saleConfirmationSingleFlight\.isActive/,
  'la UI debe reflejar el mismo lock síncrono que usan los handlers',
);
assert.match(
  sale,
  /function saleInputsAreLockedNow\(\)[\s\S]*?saleConfirmationSingleFlight\.isActive[\s\S]*?useVisitStore\.getState\(\)\.saleConfirmed/,
  'cada mutador debe consultar el ref vivo y el estado durable, no sólo React state',
);
assert.match(
  sale,
  /function handleOpenProductPicker\(\)[\s\S]*?if \(saleInputsAreLockedNow\(\)\) return;[\s\S]*?setPickerVisible\(true\)/,
  'abrir el picker debe fallar cerrado durante submit',
);
assert.match(
  sale,
  /function handleAddSaleLine\(line:\s*SaleLineItem\)[\s\S]*?if \(saleInputsAreLockedNow\(\)\) return;[\s\S]*?useVisitStore\.getState\(\)\.addSaleLine\(line\)/,
  'el sink del picker debe releer el lock en el mismo tick antes de mutar',
);
assert.match(
  sale,
  /function applyLiveSaleQuantityEdit[\s\S]*?if \(saleInputsAreLockedNow\(\)\) return;/,
  'la frontera compartida de cantidad debe tener guard síncrono',
);
assert.match(
  sale,
  /function setSaleQtyFromText[\s\S]*?applyLiveSaleQuantityEdit[\s\S]*?function changeSaleQty[\s\S]*?applyLiveSaleQuantityEdit/,
  'texto y botones deben delegar a la frontera protegida',
);
assert.match(
  sale,
  /function handleSetSalePayment[\s\S]*?if \(saleInputsAreLockedNow\(\)\) return;[\s\S]*?setSalePayment\(method\)/,
  'el pago debe tener guard síncrono',
);
assert.match(
  sale,
  /async function handleAddSalePhoto\(\)[\s\S]*?if \(saleInputsAreLockedNow\(\)\) return;[\s\S]*?await takePhoto\(\);[\s\S]*?if \(saleInputsAreLockedNow\(\)\) return;/,
  'la foto debe revalidar el lock tanto antes como después del await de cámara',
);
assert.match(sale, /onAddLine=\{handleAddSaleLine\}/, 'ProductPicker no debe escribir directo al store');
assert.match(sale, /visible=\{pickerVisible\s*&&\s*!saleInputsLocked\}/);
assert.match(sale, /editable=\{!saleInputsLocked\}/, 'cantidad debe verse bloqueada durante submit');
assert((sale.match(/disabled=\{saleInputsLocked\}/g) ?? []).length >= 5,
  'qty, pago y foto deben quedar visualmente deshabilitados durante submit');
assert.match(
  sale,
  /disabled=\{saleInputsLocked\s*\|\|\s*!onlineInventoryReady/,
  'agregar producto o confirmar debe bloquearse visualmente durante submit',
);

const successStateIdx = confirmBody.indexOf('const markedReadyToContinue = await markSaleReadyToContinue(');
assert(successStateIdx > 0);
assert.doesNotMatch(
  confirmBody.slice(successStateIdx),
  /saleConfirmationSingleFlight\.release\(\)|releaseSaleInputMutationLock\(\)/,
  'éxito remoto y navegación deben conservar congelados los inputs',
);

assert.match(
  sale,
  /disabled=\{[^}]*!onlineInventoryReady[^}]*\}/,
  'Agregar producto debe bloquearse online hasta tener inventario autoritativo',
);
assert.match(
  sale,
  /label=\{inventoryAuthorityRefreshing \? 'Actualizando inventario' : saleConfirmButtonLabel\(/,
  'Confirmar debe mostrar el estado de actualización de inventario',
);
assert.match(
  sale,
  /disabled=\{saleInputsLocked \|\| !onlineInventoryReady\}/,
  'Confirmar debe bloquearse durante submit y mientras falta autoridad online',
);

const offlineRecoveryIdx = sale.indexOf('await persistAmbiguousSaleRecovery({');
const recentRecordIdx = sale.indexOf(
  'await recordRecentProducts(confirmationInput.saleLines.map',
  offlineRecoveryIdx,
);
const offlineTicketIdx = sale.indexOf('await saveSaleTicketSnapshot(', offlineRecoveryIdx);
assert(
  offlineRecoveryIdx >= 0
    && recentRecordIdx > offlineRecoveryIdx
    && offlineTicketIdx > recentRecordIdx,
  'productos recientes deben registrarse sólo después de persistir durablemente intent y cola',
);
assert.match(
  sale.slice(offlineRecoveryIdx, offlineTicketIdx),
  /try \{[\s\S]*?await recordRecentProducts\(confirmationInput\.saleLines\.map[\s\S]*?\} catch \(recentError\) \{[\s\S]*?logWarn\(/,
  'fallar al guardar productos recientes debe ser best-effort y no revertir la venta',
);
assert.doesNotMatch(
  sale.slice(offlineRecoveryIdx, offlineTicketIdx),
  /recordRecentProducts\([^)]*price/,
  'la pantalla no debe reutilizar precios de cliente al registrar productos recientes',
);
// No se confirma offline como venta: el rótulo se deriva del estado de sync.
assert(sale.includes('saleConfirmButtonLabel') && sale.includes('getSaleSyncState'),
  'la etiqueta del botón refleja pendiente/enviado/error, no "confirmado" offline');
// Pedido muerto NO restaura stock local (S1: no se descontó al encolar).
const sync = fs.readFileSync(path.join(root, 'src/stores/useSyncStore.ts'), 'utf8');
assert(sync.includes('sale_order_dead_no_stock_rollback'),
  'rollback de sale_order debe ser no-op en S1 (no inflar stock)');

// S1: la venta NUNCA reserva/descuenta inventario localmente (ni online ni
// offline) — el backend valida/descuenta al confirmar en Odoo.
assert(!/updateLocalStock\(l\.productId,\s*-l\.qty\)/.test(sale),
  'la venta no debe descontar inventario local (S1)');
// El snapshot del ticket online se guarda DESPUÉS de que Odoo acepta.
assert.match(
  sale,
  /const saleResult = await createSale\(buildSalesCreatePayload\(payload\)\)[\s\S]*?confirmedTicketSnapshot = withSaleTicketOdooFolio\(\s*recoveryIntent\.ticketSnapshot,\s*saleResult\.name,?\s*\)[\s\S]*?saveSaleTicketSnapshot\(confirmedTicketSnapshot\)/,
  'online: captura el resultado validado, promueve el folio y guarda el ticket oficial',
);
assert.doesNotMatch(
  sale,
  /recoveryIntent\.ticketSnapshot\.(?:odooFolio|name)\s*=|recoveryIntent\.ticketSnapshot\s*=/,
  'la promoción online no muta el snapshot pendiente del intent durable',
);
assert(/sellerName:\s*employeeName/.test(sale), 'el intent del ticket guarda el vendedor (employeeName)');

// #5 insufficient_stock: el catch usa el detalle y refresca inventario real.
assert(sale.includes('getInsufficientStockDetail'), 'el catch debe parsear insufficient_stock');
assert(sale.includes('describeInsufficientStock'), 'debe mostrar el detalle al vendedor');

// UX offline (evidencia de campo): banner temprano + hint bajo el botón, sin
// deshabilitar el botón (conectividad intermitente) ni habilitar venta offline.
assert(sale.includes('describeSaleOfflineUx'), 'venta debe avisar offline antes de confirmar');
assert(sale.includes('saleOffline.showBanner') && sale.includes('AlertBanner'),
  'debe mostrar banner offline en la pantalla de venta');
assert(sale.includes('saleOffline.buttonHint'), 'debe mostrar hint offline bajo el botón');
// El readiness mantiene habilitada la venta explícitamente offline, pero
// bloquea la transición online sin autoridad.
assert.match(
  sale,
  /const onlineInventoryReady = saleStockEnforcement\.allowConfirm[\s\S]*?isOnline === false/,
  'el botón debe conservar la venta offline habilitada por la decisión explícita',
);

console.log('offline sale wiring tests: ok');
