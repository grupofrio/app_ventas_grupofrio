import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

const noSaleScreen = readFileSync(resolve(REPO_ROOT, 'app/nosale/[stopId].tsx'), 'utf8');
const gfLogistics = readFileSync(resolve(REPO_ROOT, 'src/services/gfLogistics.ts'), 'utf8');
const syncStore = readFileSync(resolve(REPO_ROOT, 'src/stores/useSyncStore.ts'), 'utf8');

function main() {
  assert.match(
    noSaleScreen,
    /noSaleReasonCode: selectedReason\.code/,
    'el motivo debe viajar como código estable del catálogo, no como id',
  );
  assert.match(
    noSaleScreen,
    /noSaleNotes: notes/,
    'las notas del vendedor deben viajar en el checkout',
  );
  assert.match(
    noSaleScreen,
    /noSaleCompetitor: effectiveCompetitor/,
    'el competidor viaja solo cuando el motivo competitor lo resolvió',
  );

  assert.match(
    noSaleScreen,
    /no_sale_reason_code: checkoutPayload\.no_sale_reason_code/,
    'el checkout online debe reenviar el motivo estructurado',
  );

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
