import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const store = readFileSync(
  resolve(process.cwd(), 'src/stores/useSalesStore.ts'),
  'utf8',
);

assert.match(
  store,
  /createSalesLoadCoordinator/,
  'el store de ventas debe usar el coordinador single-flight probado',
);
assert.match(
  store,
  /fetchSummary:\s*fetchSalesSummary/,
  'el coordinador debe cargar el resumen oficial',
);
assert.match(
  store,
  /fetchList:\s*fetchSalesList/,
  'el coordinador debe cargar la lista oficial',
);
assert.match(
  store,
  /\bloadTodaySales\s*,/,
  'el action público debe ser la función coalescida del coordinador',
);
assert.doesNotMatch(
  store,
  /if\s*\(get\(\)\.isLoading\)\s*return/,
  'el store no debe devolver undefined durante una carga activa',
);
assert.match(
  store,
  /reset:\s*\(\)\s*=>\s*\{[\s\S]*?loadTodaySales\.invalidate\(\);[\s\S]*?set\(\{/,
  'reset debe invalidar la carga anterior antes de publicar el estado inicial',
);

console.log('sales store refresh wiring tests: ok');
