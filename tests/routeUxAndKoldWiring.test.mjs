import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

const mapScreen = readFileSync(
  resolve(REPO_ROOT, 'app/map.tsx'),
  'utf8',
);
const routeScreen = readFileSync(
  resolve(REPO_ROOT, 'app/(tabs)/route.tsx'),
  'utf8',
);
const topBar = readFileSync(
  resolve(REPO_ROOT, 'src/components/ui/TopBar.tsx'),
  'utf8',
);
const pricelistCache = readFileSync(
  resolve(REPO_ROOT, 'src/services/pricelistCache.ts'),
  'utf8',
);
const offrouteSearch = readFileSync(
  resolve(REPO_ROOT, 'src/services/offrouteSearch.ts'),
  'utf8',
);
const routeStore = readFileSync(
  resolve(REPO_ROOT, 'src/stores/useRouteStore.ts'),
  'utf8',
);
const visitStore = readFileSync(
  resolve(REPO_ROOT, 'src/stores/useVisitStore.ts'),
  'utf8',
);

function main() {
  assert.match(
    topBar,
    /onBack\?: \(\) => void;/,
    'TopBar debe permitir navegación custom para cortar el stack después de la venta',
  );

  assert.match(
    mapScreen,
    /Hacer venta/,
    'el mapa debe ofrecer acción de venta al tocar un pin',
  );
  assert.match(
    mapScreen,
    /Abrir Maps/,
    'el mapa debe seguir ofreciendo navegación a Maps al tocar un pin',
  );

  assert.match(
    pricelistCache,
    /34:\s*104/,
    'el fallback de pricelist para la compañía 34 debe ser 104',
  );

  assert.match(
    offrouteSearch,
    /x_analytic_un_id/,
    'la búsqueda de visita especial debe filtrar por plaza analítica',
  );

  assert.match(
    routeScreen,
    /Buscar cliente planificado/,
    'la pantalla de ruta debe tener buscador de clientes planificados',
  );
  assert.match(
    routeScreen,
    /filterPlannedStopsBySearch\(sorted,\s*trimmedSearchQuery\)/,
    'el buscador de ruta debe filtrar con el helper de clientes planificados',
  );

  assert.match(
    routeStore,
    /_koldScore:\s*score \?\? s\._koldScore \?\? undefined/,
    'la ruta debe preservar el Kold Score que ya venga del backend',
  );

  assert.match(
    visitStore,
    /saleTax:\s*\(\)\s*=>\s*0/,
    'la venta no debe seguir sumando IVA client-side si Odoo ya entrega el precio final esperado',
  );
  assert.match(
    visitStore,
    /saleTotal:\s*\(\)\s*=>\s*get\(\)\.saleSubtotal\(\)/,
    'el total de venta debe coincidir con la suma directa de la lista de precios',
  );

  console.log('route ux and kold wiring tests: ok');
}

main();
