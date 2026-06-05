import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

function main() {
  const appConfig = JSON.parse(readFileSync(resolve(REPO_ROOT, 'app.json'), 'utf8'));
  const expo = appConfig.expo;

  assert.equal(expo.icon, './assets/grupofrio-icon.png', 'La app debe usar el logo de Grupo Frio como icono principal');
  assert.equal(expo.splash.image, './assets/grupofrio-splash.png', 'El splash debe usar el logo de Grupo Frio');
  assert.equal(
    expo.android.adaptiveIcon.foregroundImage,
    './assets/grupofrio-adaptive-foreground.png',
    'Android debe usar el logo de Grupo Frio en adaptive icon',
  );
  assert.equal(
    expo.android.adaptiveIcon.monochromeImage,
    './assets/grupofrio-adaptive-monochrome.png',
    'Android debe tener version monocromatica del logo de Grupo Frio',
  );
  assert.equal(expo.web.favicon, './assets/grupofrio-favicon.png', 'Web debe usar favicon de Grupo Frio');

  for (const asset of [
    'assets/grupofrio-icon.png',
    'assets/grupofrio-splash.png',
    'assets/grupofrio-adaptive-foreground.png',
    'assets/grupofrio-adaptive-monochrome.png',
    'assets/grupofrio-favicon.png',
  ]) {
    assert.equal(existsSync(resolve(REPO_ROOT, asset)), true, `${asset} debe existir`);
  }

  console.log('app icon wiring tests: ok');
}

main();
