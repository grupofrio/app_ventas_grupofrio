import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');

function main() {
  const routeStart = read('app/route-start.tsx');
  const routeClose = read('app/route-close.tsx');

  assert.match(
    routeStart,
    /ensureChecklistReady\(planId\)/,
    'Iniciar operación debe crear/cargar el checklist, no marcar listo cuando getVehicleChecklist regresa null',
  );
  assert.doesNotMatch(
    routeStart,
    /getVehicleChecklist\(planId\)/,
    'Iniciar operación no debe usar una lectura que deja null como checklist listo',
  );
  assert.match(
    routeStart,
    /chooseAuthoritativeKm/,
    'KM inicial en inicio debe usar un valor autoritativo de Odoo',
  );
  assert.match(
    routeClose,
    /chooseAuthoritativeKm/,
    'KM de cierre debe calcular contra el KM inicial autoritativo de Odoo',
  );
  assert.doesNotMatch(
    routeClose,
    /kmInitialStore\s*\?\?/,
    'Cierre no debe priorizar el KM local del teléfono sobre Odoo',
  );

  console.log('route start checklist/km wiring tests: ok');
}

main();
