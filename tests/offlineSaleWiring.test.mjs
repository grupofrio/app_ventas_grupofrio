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
  /const pricelistDecision = decideSalePricelist\(\{[\s\S]*?isOnline,[\s\S]*?stopPricelistId,[\s\S]*?cachedPricelistId,[\s\S]*?\}\);/,
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
  /if \(requestGate\.isCurrent\(requestToken\)\) \{[\s\S]*?setPriceMap\(loaded\.displayPrices\)[\s\S]*?setOnlineCapturedPrices\(loaded\.capturedPrices\)/,
  'una respuesta obsoleta no debe publicar precios en UI',
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
  /if \(!isOnline\) \{[\s\S]*?await persistAmbiguousSaleRecovery\(\{[\s\S]*?operationId:\s*recoveryIntent\.operationId/,
  'offline debe materializar durablemente el intent con el mismo operationId',
);
assert.doesNotMatch(
  sale,
  /useVisitStore\.setState\(\{\s*saleOperationId:\s*enqId\s*\}\)/,
  'offline no corrige el operationId sólo en memoria después de encolar',
);
assert(sale.includes('persistAmbiguousSaleRecovery'), 'venta debe usar el lote durable compartido para pedido y evidencia');
assert(!sale.includes('salePhotoUris[0]'), 'venta debe encolar todas las fotos capturadas, no solo la primera');
const offlineIdx = sale.indexOf('if (!isOnline) {');
const createIdx = sale.indexOf('await createSale(');
assert(offlineIdx > -1 && createIdx > -1 && offlineIdx < createIdx,
  'la rama offline (enqueue) va antes del createSale online');
assert(/createSale\(buildSalesCreatePayload\(payload\)\)[\s\S]*?enqueueVisitPhotos/.test(sale),
  'online: despues de crear venta en Odoo debe encolar la evidencia para subirla');
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
assert(/createSale\(buildSalesCreatePayload\(payload\)\)[\s\S]*?saveSaleTicketSnapshot/.test(sale),
  'online: snapshot del ticket después de createSale');
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
// El botón NO se deshabilita por offline (solo por saleConfirmed).
assert(/disabled=\{saleConfirmed\}/.test(sale),
  'el boton Confirmar no debe deshabilitarse por offline (solo por saleConfirmed)');

console.log('offline sale wiring tests: ok');
