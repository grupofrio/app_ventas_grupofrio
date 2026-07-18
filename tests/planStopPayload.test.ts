import assert from 'node:assert/strict';
import { normalizePlanStopPayload, extractPlanStopsArray } from '../src/services/planStopPayload.ts';

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

// P2 (Codex): SOLO un array explícito de stops es 'found' (ruta vacía real).
// Una respuesta exitosa malformada NO debe convertirse en ok+[].
function testExtractPlanStopsArray() {
  // Arrays explícitos válidos → found:true (incluye vacío REAL).
  assert.deepEqual(extractPlanStopsArray([]), { found: true, stops: [] });
  assert.deepEqual(extractPlanStopsArray([{ id: 1 }]), { found: true, stops: [{ id: 1 }] });
  assert.deepEqual(extractPlanStopsArray({ ok: true, data: { stops: [] } }), { found: true, stops: [] });
  assert.equal(extractPlanStopsArray({ ok: true, data: { stops: [{ id: 9 }] } }).found, true);
  assert.equal(extractPlanStopsArray({ stops: [{ id: 3 }] }).found, true); // top-level
  assert.equal(extractPlanStopsArray({ ok: true, data: [{ id: 4 }] }).found, true); // data-as-array

  // Respuestas exitosas MALFORMADAS → found:false (NO ok+[]).
  assert.equal(extractPlanStopsArray({ ok: true, data: {} }).found, false, 'data vacío');
  assert.equal(extractPlanStopsArray({ ok: true, data: null }).found, false, 'data null');
  assert.equal(extractPlanStopsArray({ raw: '<html>bad gateway</html>' }).found, false, 'shape inesperado');
  assert.equal(extractPlanStopsArray({ ok: true }).found, false, 'sin data ni stops');
  assert.equal(extractPlanStopsArray(null).found, false);
  assert.equal(extractPlanStopsArray(undefined).found, false);
  assert.equal(extractPlanStopsArray('html').found, false);
  assert.equal(extractPlanStopsArray({ ok: true, data: { stops: 'nope' } }).found, false, 'stops no-array');
  console.log('extract plan stops array: ok');
}

function main() {
  testBackendPricelistFieldsAreMappedForAppUi();
  testExistingClientPricelistFieldsWin();
  testExtractPlanStopsArray();
  console.log('plan stop payload tests: ok');
}

main();
