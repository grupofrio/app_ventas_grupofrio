import assert from 'node:assert/strict';

import {
  buildTruckStockPlanRequest,
} from '../src/services/truckStockPlanContext.ts';

function main() {
  assert.deepEqual(
    buildTruckStockPlanRequest(7025),
    { ok: true, body: { plan_id: 7025 } },
    'un plan activo debe ser el unico contexto enviado a truck_stock',
  );

  assert.deepEqual(
    buildTruckStockPlanRequest(null),
    { ok: false, reason: 'plan_unavailable' },
    'sin plan no debe construirse una llamada de inventario',
  );

  assert.deepEqual(
    buildTruckStockPlanRequest(0),
    { ok: false, reason: 'plan_unavailable' },
  );

  console.log('truck stock plan context tests: ok');
}

main();
