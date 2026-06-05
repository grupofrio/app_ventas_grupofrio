import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve();

function main() {
  const screen = readFileSync(resolve(REPO_ROOT, 'app/offroute.tsx'), 'utf8');

  assert.match(
    screen,
    /buildStopNavigationUrls/,
    'la visita especial debe reutilizar el helper de ubicacion de Maps',
  );
  assert.match(
    screen,
    /Alert\.alert\(\s*'Visita especial'/,
    'al seleccionar un cliente especial debe preguntar que accion realizar',
  );
  assert.match(
    screen,
    /Ir a ubicacion/,
    'la alerta debe ofrecer abrir ubicacion',
  );
  assert.match(
    screen,
    /Generar venta/,
    'la alerta debe ofrecer generar venta',
  );
  assert.match(
    screen,
    /router\.push\(`\/checkin\/\$\{virtualStopId\}` as never\)/,
    'los leads especiales deben seguir entrando a check-in',
  );

  const customerDecisionMatch = /Alert\.alert\(\s*'Visita especial'/.exec(screen);
  const customerDecisionIndex = customerDecisionMatch?.index ?? -1;
  const directSaleMatch = /router\.push\(`\/sale\/\$\{virtualStopId\}` as never\)/.exec(screen);
  const directSaleIndex = directSaleMatch?.index ?? -1;
  assert.ok(customerDecisionIndex >= 0, 'debe existir decision para cliente especial');
  assert.ok(directSaleIndex >= 0, 'la accion Generar venta debe seguir navegando a venta');
  assert.ok(
    customerDecisionIndex < directSaleIndex,
    'la navegacion a venta debe estar dentro o despues de la decision, no antes',
  );

  console.log('offroute special visit action tests: ok');
}

main();
