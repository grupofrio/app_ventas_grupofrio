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
  const truckStock = gfLogistics.slice(gfLogistics.indexOf('export async function fetchTruckStock'));

  assert.match(
    truckStock,
    /fetchTruckStock\(\s*planId: number \| null \| undefined/,
    'truck_stock debe requerir solamente el plan activo',
  );
  assert.match(
    truckStock,
    /buildTruckStockPlanRequest\(planId\)/,
    'la petición debe construirse desde plan_id, no desde los datos de almacén del empleado',
  );
  assert.doesNotMatch(
    truckStock,
    /mobile_location_id|warehouse_id/,
    'el cliente no debe seleccionar ubicación ni almacén para truck_stock',
  );
  assert.match(
    productStore,
    /const planId = useRouteStore\.getState\(\)\.plan\?\.plan_id/,
    'loadProducts debe tomar el plan activo como contexto',
  );
  assert.match(
    productStore,
    /fetchTruckStock\(planId\)/,
    'loadProducts debe consultar truck_stock con el plan activo',
  );
  console.log('truck stock plan context wiring tests: ok');
}

main();
