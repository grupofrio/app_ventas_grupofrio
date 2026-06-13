/**
 * Fix checkout lat/lon: resolución de navegación al siguiente cliente tras
 * checkout. Cubre: siguiente con/sin coords, y que NUNCA se usen coords 0,0.
 */
import assert from 'node:assert/strict';

interface Mod {
  buildCheckoutNavigation: (
    userLat: number | null | undefined,
    userLon: number | null | undefined,
    next: { customer_latitude?: number | null; customer_longitude?: number | null } | null | undefined,
  ) => { origin: { latitude: number; longitude: number } | null; destination: { latitude: number; longitude: number } } | null;
}

function run(m: Mod) {
  const next = { customer_latitude: 19.43, customer_longitude: -99.13 };

  // Siguiente con coords + vendedor con fix → origin y destination correctos.
  const a = m.buildCheckoutNavigation(20.5, -100.2, next);
  assert.ok(a);
  assert.deepEqual(a!.destination, { latitude: 19.43, longitude: -99.13 });
  assert.deepEqual(a!.origin, { latitude: 20.5, longitude: -100.2 });

  // Siguiente con coords pero SIN fix del vendedor → origin null (NO 0,0).
  const b = m.buildCheckoutNavigation(null, null, next);
  assert.ok(b);
  assert.equal(b!.origin, null);
  assert.deepEqual(b!.destination, { latitude: 19.43, longitude: -99.13 });

  // Vendedor en 0,0 (isla nula) → origin null, no se inyecta coord falsa.
  const c = m.buildCheckoutNavigation(0, 0, next);
  assert.ok(c);
  assert.equal(c!.origin, null);

  // Siguiente SIN coordenadas → null (no se inicia navegación).
  assert.equal(m.buildCheckoutNavigation(20.5, -100.2, { customer_latitude: null, customer_longitude: null }), null);
  assert.equal(m.buildCheckoutNavigation(20.5, -100.2, { customer_latitude: 19.43 }), null);
  assert.equal(m.buildCheckoutNavigation(20.5, -100.2, null), null);
  // Siguiente con coord 0 (inválida) → null.
  assert.equal(m.buildCheckoutNavigation(20.5, -100.2, { customer_latitude: 0, customer_longitude: 0 }), null);

  console.log('checkout navigation tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/checkoutNavigation.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
