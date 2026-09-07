import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();
const refreshButtonPath = resolve(REPO_ROOT, 'src/components/ui/GlobalRefreshButton.tsx');

const rootLayout = readFileSync(
  resolve(REPO_ROOT, 'app/_layout.tsx'),
  'utf8',
);

function main() {
  assert.match(
    rootLayout,
    /GlobalRefreshButton/,
    'el layout raiz debe montar un boton global para refrescar datos operativos',
  );
  assert.match(
    rootLayout,
    /<Slot\s*\/>[\s\S]*<GlobalRefreshButton\s*\/>[\s\S]*<GlobalHomeButton\s*\/>/,
    'el boton de refresh debe quedar arriba del boton home en la capa global',
  );
  assert.equal(
    existsSync(refreshButtonPath),
    true,
    'debe existir un componente dedicado para el boton global de refresh',
  );

  const refreshButton = readFileSync(refreshButtonPath, 'utf8');
  assert.match(
    refreshButton,
    /Ionicons[\s\S]*name=\{refreshing \? 'sync' : 'refresh'\}/,
    'el boton global debe usar icono de refresh y estado de sincronizacion',
  );
  assert.match(
    refreshButton,
    /clearPricelistCaches\(\)/,
    'el refresh debe limpiar caches de lista de precio',
  );
  assert.match(
    refreshButton,
    /await loadProducts\(\)/,
    'el refresh debe recargar inventario usando el plan activo',
  );
  assert.match(
    refreshButton,
    /await loadPlan\(\{ force: true \}\)/,
    'el refresh debe obtener primero el plan activo',
  );
  assert.doesNotMatch(
    refreshButton,
    /loadProducts\(warehouseId\)/,
    'el refresh no debe depender del almacen del empleado',
  );

  console.log('global refresh button tests: ok');
}

main();
