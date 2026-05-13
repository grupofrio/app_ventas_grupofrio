import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const homeButtonPath = resolve(REPO_ROOT, 'src/components/ui/GlobalHomeButton.tsx');

const rootLayout = readFileSync(
  resolve(REPO_ROOT, 'app/_layout.tsx'),
  'utf8',
);

function main() {
  assert.match(
    rootLayout,
    /GlobalHomeButton/,
    'el layout raíz debe montar un botón global para volver al home',
  );
  assert.match(
    rootLayout,
    /<Slot\s*\/>[\s\S]*<GlobalHomeButton\s*\/>/,
    'el botón de home debe quedar superpuesto a toda la app, después del Slot',
  );
  assert.equal(
    existsSync(homeButtonPath),
    true,
    'debe existir un componente dedicado para el botón global de home',
  );

  const homeButton = readFileSync(homeButtonPath, 'utf8');
  assert.match(
    homeButton,
    /Ionicons[\s\S]*name="home"/,
    'el botón global debe usar un icono de casita',
  );
  assert.match(
    homeButton,
    /router\.replace\('\/\(tabs\)' as never\)/,
    'el botón global debe regresar al home sin apilar pantallas',
  );

  console.log('global home button tests: ok');
}

main();
