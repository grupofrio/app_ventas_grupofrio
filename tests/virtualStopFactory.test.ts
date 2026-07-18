import assert from 'node:assert/strict';

type Mod = typeof import('../src/services/virtualStopFactory.ts');

function testPreservesAddress(m: Mod) {
  const stop = m.createVirtualStop({
    customerId: 21805,
    customerName: 'Abarrotes Estrada',
    street: 'Av. Juárez 100',
    city: 'Puebla',
    customerLatitude: 19.4,
    customerLongitude: -99.1,
    now: 1_700_000_123_456,
  });
  // La dirección off-route ya NO se pierde al crear la parada virtual.
  assert.equal(stop.street, 'Av. Juárez 100');
  assert.equal(stop.city, 'Puebla');
  assert.equal(stop.customer_latitude, 19.4);
  assert.equal(stop._isOffroute, true);
  assert.ok(stop.id < 0, 'id de parada virtual es negativo');
  console.log('preserves address: ok');
}

function testAddressOmittedWhenAbsent(m: Mod) {
  // Sin dirección → campos undefined (no strings vacíos), forward-compatible.
  const stop = m.createVirtualStop({
    customerId: 10,
    customerName: 'Cliente sin dirección',
    now: 1_700_000_123_456,
  });
  assert.equal(stop.street, undefined);
  assert.equal(stop.city, undefined);
  console.log('address omitted when absent: ok');
}

async function main() {
  const m = (await import(
    // @ts-ignore -- import.meta solo existe en el runtime de test.
    new URL('../src/services/virtualStopFactory.ts', import.meta.url).pathname
  )) as Mod;

  testPreservesAddress(m);
  testAddressOmittedWhenAbsent(m);
  console.log('virtualStopFactory tests: ok');
}

void main();
