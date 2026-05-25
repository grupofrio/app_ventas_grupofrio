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

  assert.match(
    checkinScreen,
    /Abrir ubicación/,
    'el botón debe existir en la pantalla de check-in',
  );
  assert.doesNotMatch(
    postvisitScreen,
    /Abrir ubicación/,
    'el botón no debe quedarse en la pantalla de prospección',
  );

  console.log('location button placement tests: ok');
}

main();
