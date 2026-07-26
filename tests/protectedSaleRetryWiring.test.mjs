import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const store = read('src/stores/useSyncStore.ts');
const sync = read('app/sync.tsx');
const sales = read('app/(tabs)/sales.tsx');

assert.match(store, /clearUnprotectedDeadItems/);
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
assert.match(sync, /removed[\s\S]*protected|protected[\s\S]*removed/,
  'el resultado reporta eliminadas y protegidas');

console.log('protected sale retry wiring tests: ok');
