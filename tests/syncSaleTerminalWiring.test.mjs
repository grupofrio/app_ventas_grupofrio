import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const syncStore = readFileSync(
  resolve(process.cwd(), 'src/stores/useSyncStore.ts'),
  'utf8',
);

assert.match(
  syncStore,
  /import\s*\{\s*processSyncItemToCompletion\s*\}\s*from\s*['"]\.\.\/services\/syncItemCompletion['"]/,
  'el store consume el helper conductual de finalización',
);
assert.match(
  syncStore,
  /import\s*\{\s*useVisitStore\s*\}\s*from\s*['"]\.\/useVisitStore['"]/,
  'sync puede persistir el marker terminal sin ciclo inverso desde visit',
);
assert.match(
  syncStore,
  /await processSyncItemToCompletion\(\{[\s\S]*?item,[\s\S]*?process:\s*processSyncItem,[\s\S]*?markSaleReadyToContinue:\s*\(operationId\)\s*=>\s*useVisitStore\.getState\(\)\.markSaleReadyToContinue\(operationId\),[\s\S]*?markDone:\s*\(id\)\s*=>\s*get\(\)\.markDone\(id\),[\s\S]*?\}\);/,
  'processOneItem delega process → marker estricto → markDone',
);

console.log('sync sale terminal wiring tests: ok');
