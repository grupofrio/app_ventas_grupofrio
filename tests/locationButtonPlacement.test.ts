import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve();

function main() {
  const checkinScreen = readFileSync(
    resolve(REPO_ROOT, 'app/checkin/[stopId].tsx'),
    'utf8',
  );
  const postvisitScreen = readFileSync(
    resolve(REPO_ROOT, 'app/postvisit/[stopId].tsx'),
    'utf8',
  );
  const routeScreen = readFileSync(
    resolve(REPO_ROOT, 'app/(tabs)/route.tsx'),
    'utf8',
  );

  assert.match(
    checkinScreen,
    /Abrir ubicación/,
    'el botón debe existir en la pantalla de check-in',
  );
  assert.match(
    checkinScreen,
    /checkInActionRow/,
    'el botón de ubicación debe estar junto al botón de check-in',
  );
  assert.match(
    routeScreen,
    /buildStopNavigationUrls/,
    'la lista de ruta debe reutilizar el helper de URLs de Maps',
  );
  assert.match(
    routeScreen,
    /📍 Maps/,
    'cada cliente en la lista de ruta debe ofrecer un botón directo a Maps',
  );
  assert.doesNotMatch(
    postvisitScreen,
    /Abrir ubicación/,
    'el botón no debe quedarse en la pantalla de prospección',
  );

  console.log('location button placement tests: ok');
}

main();
