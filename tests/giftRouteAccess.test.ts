import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve();

const stopScreen = readFileSync(
  resolve(REPO_ROOT, 'app/stop/[stopId].tsx'),
  'utf8',
);
const checkinScreen = readFileSync(
  resolve(REPO_ROOT, 'app/checkin/[stopId].tsx'),
  'utf8',
);
const leadVisit = readFileSync(
  resolve(REPO_ROOT, 'src/services/leadVisit.ts'),
  'utf8',
);

function main() {
  assert.match(
    stopScreen,
    /label="🎁 Regalo"/,
    'la pantalla de visita debe renderizar el botón 🎁 Regalo',
  );
  assert.match(
    stopScreen,
    /router\.push\(`\/gift\/\$\{stop\.id\}\?from=stop` as never\)/,
    'el botón Regalo debe navegar a /gift/[stopId]',
  );
  assert.match(
    checkinScreen,
    /Text style=\{styles\.actionLabel\}>Registrar Regalo</,
    'el grid post-check-in debe mostrar Registrar Regalo junto a Venta',
  );
  assert.match(
    checkinScreen,
    /router\.push\(`\/gift\/\$\{stop\.id\}\?from=checkin` as never\)/,
    'el acceso post-check-in debe navegar a /gift/[stopId]',
  );
  assert.match(
    leadVisit,
    /showGift: true/,
    'la visibilidad de acciones debe dejar Regalo visible para leads y customers',
  );
  console.log('gift route access tests: ok');
}

main();
