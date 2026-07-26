import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const checkout = readFileSync(
  resolve(process.cwd(), 'app/checkout/[stopId].tsx'),
  'utf8',
);
const store = readFileSync(
  resolve(process.cwd(), 'src/stores/useSyncStore.ts'),
  'utf8',
);

assert.match(
  store,
  /retrySaleOrder:\s*\(operationId:\s*string\)\s*=>\s*Promise<void>/,
  'el store expone la acción pública tipada',
);
assert.match(
  store,
  /retrySaleOrder:\s*\(operationId\)\s*=>/,
  'el store implementa la acción pública',
);
assert.match(
  checkout,
  /const retrySaleOrder = useSyncStore\(\(s\) => s\.retrySaleOrder\)/,
  'checkout consume la acción pública',
);
assert.match(
  checkout,
  /await retrySaleOrder\(saleOperationId\)/,
  'checkout reintenta mediante la acción durable',
);
assert.doesNotMatch(
  checkout,
  /useSyncStore\.setState/,
  'checkout no debe mutar directamente la cola',
);
assert.doesNotMatch(
  checkout,
  /rearmSaleOrderForRetry/,
  'checkout no debe importar el transformador interno',
);

console.log('checkout sale retry action wiring tests: ok');
