import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = '.';

function main() {
  const gfLogistics = readFileSync(
    resolve(REPO_ROOT, 'src/services/gfLogistics.ts'),
    'utf8',
  );
  const productStore = readFileSync(
    resolve(REPO_ROOT, 'src/stores/useProductStore.ts'),
    'utf8',
  );

  assert.match(
    gfLogistics,
    /mobileLocationId: number \| null \| undefined/,
    'fetchTruckStock debe aceptar mobileLocationId ademas de warehouseId',
  );
  assert.match(
    gfLogistics,
    /body\.mobile_location_id = mobileLocationId/,
    'truck_stock debe enviar mobile_location_id cuando la sesion tenga ubicacion movil',
  );
  assert.match(
    productStore,
    /useAuthStore\.getState\(\)\.mobileLocationId/,
    'loadProducts debe usar mobileLocationId de auth al consultar truck_stock',
  );
  assert.match(
    productStore,
    /fetchTruckStock\(warehouseId,\s*mobileLocationId\)/,
    'loadProducts debe pasar mobileLocationId al endpoint truck_stock',
  );
  console.log('truck stock mobile location tests: ok');
}

main();
