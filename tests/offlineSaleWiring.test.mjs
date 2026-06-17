import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * Wiring de los guards offline de venta (riesgos reportados por Sebastián):
 *  #1 ProductPicker no cuelga sin red; #2 venta bloqueada offline con mensaje;
 *  #3 venta NO se encola como confirmada; #5 insufficient_stock muestra stock.
 */
const root = process.cwd();
const picker = fs.readFileSync(path.join(root, 'src/components/domain/ProductPicker.tsx'), 'utf8');
const sale = fs.readFileSync(path.join(root, 'app/sale/[stopId].tsx'), 'utf8');

// #1 ProductPicker: guard isOnline antes del fetch de precios (no cuelga offline).
assert(picker.includes('useSyncStore'), 'ProductPicker debe leer isOnline');
assert(/if \(!isOnline\)/.test(picker), 'price effect debe cortar el fetch si !isOnline');

// #2 venta bloqueada offline con mensaje claro, ANTES de bloquear/lockear.
assert(sale.includes('Venta requiere conexion'), 'venta debe bloquear offline con mensaje');
const offlineIdx = sale.indexOf('if (!isOnline)');
const lockIdx = sale.indexOf('lockSaleConfirm()');
assert(offlineIdx > -1 && lockIdx > -1 && offlineIdx < lockIdx,
  'el guard offline debe ir ANTES de lockSaleConfirm (no deja estado ambiguo)');

// #3 la venta NO se encola como confirmada/pendiente: el screen llama createSale
// directo (online-first) y NO usa enqueue('sale_order', ...).
assert(sale.includes('await createSale('), 'venta usa createSale online-first');
assert(!/enqueue\(\s*['"]sale_order['"]/.test(sale), 'la venta NO debe encolarse como sale_order');

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
