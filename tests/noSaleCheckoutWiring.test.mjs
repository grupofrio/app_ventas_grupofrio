import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

const noSaleScreen = readFileSync(resolve(REPO_ROOT, 'app/nosale/[stopId].tsx'), 'utf8');
const gfLogistics = readFileSync(resolve(REPO_ROOT, 'src/services/gfLogistics.ts'), 'utf8');
const syncStore = readFileSync(resolve(REPO_ROOT, 'src/stores/useSyncStore.ts'), 'utf8');

function main() {
  // La pantalla de no-venta arma el checkout con el detalle estructurado.
  assert.match(
    noSaleScreen,
    /noSaleReasonCode: reason\?\.code/,
    'el motivo debe viajar como código estable del catálogo, no como id',
  );
  assert.match(
    noSaleScreen,
    /noSaleNotes: notes/,
    'las notas del vendedor deben viajar en el checkout',
  );
  assert.match(
    noSaleScreen,
    /noSaleCompetitor: selectedReasonId === COMPETITOR_REASON_ID \? selectedCompetitor : null/,
    'el competidor solo viaja cuando el motivo es competidor',
  );

  // Ruta online: checkOut recibe el detalle.
  assert.match(
    noSaleScreen,
    /no_sale_reason_code: checkoutPayload\.no_sale_reason_code/,
    'el checkout online debe reenviar el motivo estructurado',
  );

  // Ruta encolada: el dispatcher de la cola reenvía las claves del payload.
  assert.match(
    syncStore,
    /no_sale_reason_code: payload\.no_sale_reason_code as string \| undefined/,
    'el dispatcher de checkout debe reenviar el motivo desde la cola',
  );
  assert.match(
    syncStore,
    /no_sale_competitor: payload\.no_sale_competitor as string \| undefined/,
    'el dispatcher de checkout debe reenviar el competidor desde la cola',
  );

  // El servicio HTTP incluye las claves solo cuando tienen contenido.
  assert.match(
    gfLogistics,
    /noSaleDetail\?\.no_sale_reason_code/,
    'checkOut debe aceptar el detalle de no-venta',
  );
  assert.match(
    gfLogistics,
    /no_sale_competitor: noSaleDetail\.no_sale_competitor/,
    'checkOut debe postear el competidor cuando existe',
  );

  console.log('no sale checkout wiring tests: ok');
}

main();
