import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const store = read('src/stores/useSyncStore.ts');
const sync = read('app/sync.tsx');
const sales = read('app/(tabs)/sales.tsx');

assert.match(store, /createDeadCleanupAction/);
assert.match(store, /createSaleOrderRetryAction/);
assert.match(store, /queuePersistence\.transformAndPersist/);
assert.match(store, /retrySaleOrder:\s*\(operationId\)\s*=>/);

for (const [name, source] of [['Sync', sync], ['Ventas', sales]]) {
  assert.match(source, /retrySaleOrder/, `${name} usa la acción pública`);
  assert.match(source, /isOnline/, `${name} requiere conectividad live`);
  assert.match(source, /Reintentar/, `${name} muestra la acción explícita`);
  assert.match(source, /requiresStockRetry|isProtectedStockSyncItem/, `${name} limita la acción a stock protegido`);
}

assert.match(sync, /ventas? rechazadas? por stock[\s\S]*permanecer/i,
  'la confirmación aclara que las ventas protegidas permanecen');
assert.match(sync, /clearUnprotectedDeadItems\(queue\)/,
  'el conteo visual usa la misma política transitiva que la limpieza durable');
assert.match(sync, /removed[\s\S]*protected|protected[\s\S]*removed/,
  'el resultado reporta eliminadas y protegidas');
assert.match(store, /clearDead:\s*\(\)\s*=>\s*Promise<\{ removed: number; protected: number \}>/,
  'clearDead es una barrera durable async');
assert.match(store, /clearDead:\s*\(\)\s*=>\s*clearDeadAction\(\)/,
  'el store delega la limpieza a la acción coalescida');
assert.doesNotMatch(
  store.match(/clearDead:\s*\(\)\s*=>[\s\S]*?\n\s*retrySaleOrder:/)?.[0] ?? '',
  /schedulePersist/,
  'clearDead no usa persistencia debounce',
);

for (const [name, source, pattern] of [
  ['Sync', sync, /async function handleRetryProtectedSale[\s\S]*?\n  \}/],
  ['Ventas', sales, /async function retryProtectedSale[\s\S]*?\n  \}/],
]) {
  const handler = source.match(pattern)?.[0] ?? '';
  assert.ok(handler, `se localiza handler de ${name}`);
  assert.doesNotMatch(handler, /\.message\b/, `${name} no expone error.message`);
  assert.match(handler, /No pudimos reintentar la venta|Intenta nuevamente con conexión/,
    `${name} usa copy fija segura`);
}

console.log('protected sale retry wiring tests: ok');
