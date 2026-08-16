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
 * Wiring de venta offline (modelo "pedido pendiente de envío", S2 desde F3.2):
 *  #1 ProductPicker no cuelga sin red; #2 online sigue siendo createSale directo;
 *  #3 offline ENCOLA sale_order (+ foto) sin marcar confirmada; #5 insufficient_stock;
 *  #6 la venta descuenta inventario local optimistamente (S2), con rollback
 *  automático vía `_localStockDelta` si el pedido muere en la cola.
 */
const root = process.cwd();
const picker = fs.readFileSync(path.join(root, 'src/components/domain/ProductPicker.tsx'), 'utf8');
const sale = fs.readFileSync(path.join(root, 'app/sale/[stopId].tsx'), 'utf8');

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

// #2 ONLINE: venta sigue siendo online-first (createSale directo).
assert(sale.includes('await createSale('), 'venta online usa createSale directo');

// #3 OFFLINE: el pedido se ENCOLA como sale_order (+ foto) y NO se confirma
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
const offlineBranch = extractBracedBlockAfter(sale, 'if (!isOnline)');
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
// No se confirma offline como venta: el rótulo se deriva del estado de sync.
assert(sale.includes('saleConfirmButtonLabel') && sale.includes('getSaleSyncState'),
  'la etiqueta del botón refleja pendiente/enviado/error, no "confirmado" offline');
// Fallback legacy: ítems pre-F3.2 sin `_localStockDelta` no restauran stock
// (nunca se descontó al encolar bajo la política S1 anterior).
const sync = fs.readFileSync(path.join(root, 'src/stores/useSyncStore.ts'), 'utf8');
assert(sync.includes('sale_order_dead_no_stock_rollback'),
  'rollback de sale_order sin delta debe seguir siendo no-op (legacy S1)');

// #6 S2 (F3.2): la venta SÍ descuenta inventario local optimistamente, con
// el delta viajando en el payload encolado para rollback automático.
assert(sale.includes("from '../../src/services/stockRollback'") && sale.includes('buildLocalStockDelta'),
  'venta debe construir el delta de stock local para el rollback genérico');
assert(sale.includes('applySaleStockViaLedger'),
  'la venta debe aplicar inventario vía ledger (POST-R1A)');
assert.doesNotMatch(sale, /updateLocalStock\(l\.productId,\s*-l\.qty\)/,
  'la venta no debe mutar stock con updateLocalStock directo');
assert(/_localStockDelta:\s*localStockDelta/.test(sale),
  'el payload encolado debe llevar el delta de stock local para el rollback');
assert(/_ledgerApplied:\s*true/.test(sale),
  'el payload encolado debe marcar _ledgerApplied');
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
// El botón NO se deshabilita por offline (solo por saleConfirmed).
assert(/disabled=\{saleConfirmed\}/.test(sale),
  'el boton Confirmar no debe deshabilitarse por offline (solo por saleConfirmed)');

console.log('offline sale wiring tests: ok');
