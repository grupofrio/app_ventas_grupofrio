import assert from 'node:assert/strict';
import { normalizePlanStopPayload } from '../src/services/planStopPayload.ts';

function testBackendPricelistFieldsAreMappedForAppUi() {
  const stop = normalizePlanStopPayload({
    id: 21805,
    customer_id: 51063,
    customer_name: 'ABARROTES ESTRADA',
    state: 'pending',
    source_model: 'gf.route.stop',
    pricelist_id: 120,
    pricelist_name: 'IGUALA APAXTLA (MXN)',
  });

  assert.equal(stop._pricelistId, 120);
  assert.equal(stop._pricelistName, 'IGUALA APAXTLA (MXN)');
}

function testExistingClientPricelistFieldsWin() {
  const stop = normalizePlanStopPayload({
    id: 21805,
    customer_id: 51063,
    customer_name: 'ABARROTES ESTRADA',
    state: 'pending',
    source_model: 'gf.route.stop',
    pricelist_id: 120,
    pricelist_name: 'IGUALA APAXTLA (MXN)',
    _pricelistId: 99,
    _pricelistName: 'CLIENT SIDE',
  });

  assert.equal(stop._pricelistId, 99);
  assert.equal(stop._pricelistName, 'CLIENT SIDE');
}

function main() {
  testBackendPricelistFieldsAreMappedForAppUi();
  testExistingClientPricelistFieldsWin();
  console.log('plan stop payload tests: ok');
}

main();
