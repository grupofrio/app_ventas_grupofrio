import assert from 'node:assert/strict';

type Mod = typeof import('../src/services/formatCustomerAddress.ts');

function testCompleteAddress(m: Mod) {
  const r = m.formatCustomerAddress(
    { street: 'Av. Juárez 100', city: 'Puebla', state_name: 'Puebla', zip: '72000' },
    { customer_latitude: 19, customer_longitude: -98 },
  );
  assert.equal(r.kind, 'address');
  assert.equal(r.hasAddress, true);
  assert.equal(r.text, 'Av. Juárez 100, Puebla, Puebla, 72000');
  console.log('complete address: ok');
}

function testPartialAddress(m: Mod) {
  // solo street → se muestra lo disponible
  const r = m.formatCustomerAddress({ street: 'Calle sin número' }, null);
  assert.equal(r.kind, 'address');
  assert.equal(r.text, 'Calle sin número');
  // pre-formateado gana sobre la composición
  const r2 = m.formatCustomerAddress(
    { street: 'ignora', formatted_address: 'DIRECCIÓN CANÓNICA 5' },
    null,
  );
  assert.equal(r2.text, 'DIRECCIÓN CANÓNICA 5');
  console.log('partial address: ok');
}

function testReference(m: Mod) {
  // P2 (Codex): referencia/landmark NUNCA es dirección principal ni hasAddress.

  // (3) dirección real + referencia → dirección como principal, referencia aparte
  const r = m.formatCustomerAddress(
    { street: 'Av. 5', location_reference: 'portón azul frente a la primaria' },
    null,
  );
  assert.equal(r.kind, 'address');
  assert.equal(r.hasAddress, true);
  assert.equal(r.text, 'Av. 5');
  assert.equal(r.reference, 'portón azul frente a la primaria');

  // (1) SOLO landmark, sin dirección ni geo → 'none' + referencia aparte
  const only = m.formatCustomerAddress({ landmark: 'junto al OXXO' }, null);
  assert.equal(only.kind, 'none');
  assert.equal(only.hasAddress, false, 'landmark NO cuenta como dirección');
  assert.equal(only.text, m.ADDRESS_FALLBACK_NONE);
  assert.equal(only.reference, 'junto al OXXO');

  // (2) referencia + geo, sin dirección → 'geo' + referencia aparte
  const geoRef = m.formatCustomerAddress(
    { reference: 'frente a la primaria' },
    { customer_latitude: 19.4, customer_longitude: -99.1 },
  );
  assert.equal(geoRef.kind, 'geo');
  assert.equal(geoRef.hasAddress, false);
  assert.equal(geoRef.text, m.ADDRESS_FALLBACK_GEO);
  assert.equal(geoRef.reference, 'frente a la primaria');
  console.log('reference: ok');
}

function testOnlyGeo(m: Mod) {
  const r = m.formatCustomerAddress({}, { customer_latitude: 19.4, customer_longitude: -99.1 });
  assert.equal(r.kind, 'geo');
  assert.equal(r.hasAddress, false);
  assert.equal(r.text, m.ADDRESS_FALLBACK_GEO);
  // (0,0) NO cuenta como geo válida
  const r0 = m.formatCustomerAddress({}, { customer_latitude: 0, customer_longitude: 0 });
  assert.equal(r0.kind, 'none');
  console.log('only geo: ok');
}

function testNoData(m: Mod) {
  const r = m.formatCustomerAddress({}, null);
  assert.equal(r.kind, 'none');
  assert.equal(r.hasAddress, false);
  assert.equal(r.text, m.ADDRESS_FALLBACK_NONE);
  // strings vacíos/espacios se ignoran
  const r2 = m.formatCustomerAddress({ street: '  ', city: '' }, undefined);
  assert.equal(r2.kind, 'none');
  // undefined fields → none
  const r3 = m.formatCustomerAddress(undefined, null);
  assert.equal(r3.kind, 'none');
  console.log('no data: ok');
}

async function main() {
  const m = (await import(
    // @ts-ignore -- import.meta solo existe en el runtime de test.
    new URL('../src/services/formatCustomerAddress.ts', import.meta.url).pathname
  )) as Mod;

  testCompleteAddress(m);
  testPartialAddress(m);
  testReference(m);
  testOnlyGeo(m);
  testNoData(m);
  console.log('formatCustomerAddress tests: ok');
}

void main();
