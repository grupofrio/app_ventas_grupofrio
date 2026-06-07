/**
 * P2: guards de KM absurdo. Las reglas duras (km>0, final>=inicial) NO cambian;
 * estos solo detectan valores absurdos para pedir confirmación.
 */
import assert from 'node:assert/strict';

interface Mod {
  isValidKm: (km: unknown) => boolean;
  calculateKmDriven: (i: number | null | undefined, f: number | null | undefined) => number | null;
  isAbsurdOdometer: (km: unknown) => boolean;
  isAbsurdKmDriven: (driven: number | null | undefined) => boolean;
  MAX_REASONABLE_ODOMETER_KM: number;
  MAX_REASONABLE_KM_PER_DAY: number;
}

function run(m: Mod) {
  // Reglas duras intactas
  assert.equal(m.isValidKm(0), false);
  assert.equal(m.isValidKm(-5), false);
  assert.equal(m.isValidKm(120), true);
  assert.equal(m.calculateKmDriven(100, 80), null); // final < inicial
  assert.equal(m.calculateKmDriven(100, 100), 0);
  assert.equal(m.calculateKmDriven(100, 250), 150);

  // Odómetro absurdo
  assert.equal(m.isAbsurdOdometer(m.MAX_REASONABLE_ODOMETER_KM + 1), true);
  assert.equal(m.isAbsurdOdometer(m.MAX_REASONABLE_ODOMETER_KM), false);
  assert.equal(m.isAbsurdOdometer(52428), false);
  assert.equal(m.isAbsurdOdometer('99999999'), true);
  assert.equal(m.isAbsurdOdometer('abc'), false);

  // Recorrido diario absurdo
  assert.equal(m.isAbsurdKmDriven(m.MAX_REASONABLE_KM_PER_DAY + 1), true);
  assert.equal(m.isAbsurdKmDriven(m.MAX_REASONABLE_KM_PER_DAY), false);
  assert.equal(m.isAbsurdKmDriven(120), false);
  assert.equal(m.isAbsurdKmDriven(null), false);
  assert.equal(m.isAbsurdKmDriven(undefined), false);

  console.log('km guards tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/routeStartLogic.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
