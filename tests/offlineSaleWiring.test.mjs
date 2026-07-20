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

// #3 OFFLINE (S1): el pedido se ENCOLA como sale_order (+ foto) y NO se confirma
// offline. La rama offline va DESPUÉS de construir el payload (no antes de lock).
assert(/enqueue\(\s*['"]sale_order['"]/.test(sale), 'offline debe encolar el pedido como sale_order');
assert(sale.includes('enqueueVisitPhotos'), 'venta debe usar el helper compartido para encolar evidencia');
assert(/imageType:\s*['"]sale['"]/.test(sale), 'venta debe marcar la evidencia como imagen de venta');
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
assert(/sellerName:\s*employeeName/.test(sale), 'el ticket guarda el vendedor (employeeName)');

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
