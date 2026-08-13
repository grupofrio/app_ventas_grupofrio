import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * F3.6 — el radio de geocerca vive en UNA sola constante exportada
 * (useLocationStore.ts). Antes checkin/[stopId].tsx y trustSignals.ts
 * declaraban su propia copia local de "50", sin relación entre ellas.
 */
const root = process.cwd();

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function main() {
  const store = read('src/stores/useLocationStore.ts');
  assert(/export const GEO_FENCE_RADIUS_M = 50;/.test(store),
    'useLocationStore.ts debe exportar la constante única de geocerca');

  const checkin = read('app/checkin/[stopId].tsx');
  assert(/import \{ useLocationStore, GEO_FENCE_RADIUS_M \} from '\.\.\/\.\.\/src\/stores\/useLocationStore'/.test(checkin),
    'check-in debe importar la constante compartida, no redeclararla');
  assert.doesNotMatch(checkin, /const GEOFENCE_RADIUS_M\s*=\s*50/,
    'check-in ya no debe tener su propia copia local del radio de geocerca');

  const stopScreen = read('app/stop/[stopId].tsx');
  assert(/GEO_FENCE_RADIUS_M/.test(stopScreen),
    'la pantalla de parada debe pasar la constante compartida a describeGeoStatus');
  assert(/withinThresholdMeters:\s*GEO_FENCE_RADIUS_M/.test(stopScreen),
    'describeGeoStatus debe recibir el umbral desde la fuente única, no su default interno');

  // La ubicación (0,0) sigue bloqueada en el check-in real (ya existía,
  // F3.6 no debía tocar esta parte — solo confirmar que sigue ahí).
  assert(/latitude === 0 && longitude === 0/.test(checkin),
    'check-in debe seguir bloqueando una posición (0,0) sin fix real de GPS');

  console.log('geofence constant unification wiring tests: ok');
}

main();
