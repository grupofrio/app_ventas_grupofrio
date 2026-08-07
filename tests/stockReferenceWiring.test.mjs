import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

const picker = readFileSync(resolve(REPO_ROOT, 'src/components/domain/ProductPicker.tsx'), 'utf8');
const visitStore = readFileSync(resolve(REPO_ROOT, 'src/stores/useVisitStore.ts'), 'utf8');
const saleScreen = readFileSync(resolve(REPO_ROOT, 'app/sale/[stopId].tsx'), 'utf8');
const trustSignals = readFileSync(resolve(REPO_ROOT, 'src/services/trustSignals.ts'), 'utf8');

function main() {
  // Política: el stock local/cacheado es REFERENCIA, no tope duro. El backend
  // valida el stock real (insufficient_stock ya refresca y conserva carrito).

  // Picker: los agotados se muestran y se pueden agregar.
  assert.doesNotMatch(
    picker,
    /if \(product\.qty_display <= 0\) return;/,
    'el picker ya no debe vetar agregar productos con stock de referencia 0',
  );
  assert.doesNotMatch(
    picker,
    /const disabled = outOfStock \|\| alreadyAdded;/,
    'una fila agotada ya no debe quedar deshabilitada',
  );
  // Stepper sin tope por stock cacheado (tope sano anti-dedo).
  assert.match(picker, /REFERENTIAL_MAX_QTY = 999/, 'el stepper usa tope sano, no el stock cacheado');
  assert.doesNotMatch(
    picker,
    /qty >= p\.qty_display/,
    'el stepper no debe topar contra el stock de referencia',
  );
  // La línea agregada no se recorta al stock cacheado.
  assert.doesNotMatch(
    picker,
    /qty: Math\.min\(qty, product\.qty_display\),/,
    'la cantidad elegida no debe recortarse al stock de referencia',
  );

  // Carrito: sin recorte silencioso al stock capturado (que puede estar stale).
  assert.doesNotMatch(
    visitStore,
    /\{ \.\.\.l, qty: Math\.min\(qty, l\.stock\) \}/,
    'updateSaleQty no debe recortar contra el stock capturado',
  );

  // Confirmación: cantidades inválidas bloquean; exceder referencia pide
  // confirmación explícita y el backend decide.
  assert.match(saleScreen, /kind === 'invalid_qty'/, 'las cantidades inválidas siguen bloqueando');
  assert.match(saleScreen, /Enviar de todos modos/, 'exceder la referencia pide confirmación, no bloquea');
  assert.match(
    saleScreen,
    /El servidor validará el stock real al confirmar/,
    'el copy comunica que el backend es la autoridad',
  );
  assert.match(saleScreen, /overStockAckRef/, 'el reintento confirmado no re-pregunta');
  // El botón de confirmar ya no se apaga por stock.
  assert.doesNotMatch(
    saleScreen,
    /&& hasStock &&/,
    'canConfirm no debe depender del stock de referencia',
  );

  // El hint de bloqueo ya no menciona stock.
  assert.doesNotMatch(
    trustSignals,
    /Ajusta cantidades al stock disponible/,
    'describeSaleConfirmBlock ya no bloquea por stock',
  );

  // El manejo autoritativo del backend sigue intacto.
  assert.match(saleScreen, /getInsufficientStockDetail/, 'insufficient_stock del backend sigue manejado');

  console.log('stock reference wiring tests: ok');
}

main();
