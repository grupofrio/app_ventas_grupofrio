import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/stores/useRoutePreparationStore.ts'),
  'utf8',
);

assert.match(
  source,
  /const preparationRequestedOnline = useSyncStore\.getState\(\)\.isOnline/,
  'the explicit preparation must capture whether it was requested online',
);
assert.match(
  source,
  /refreshRoutePreparationCatalog\(\{[\s\S]*?loadProductsAuthoritative[\s\S]*?readCatalog:[\s\S]*?\}\)/,
  'online preparation must cross the authoritative catalog boundary',
);
assert.match(
  source,
  /if \(!catalogRefresh\.ok\)[\s\S]*?return;[\s\S]*?products = \[\.\.\.catalogRefresh\.products\]/,
  'pricing must stop on failed authority and snapshot only refreshed products',
);

console.log('route preparation authoritative catalog wiring tests: ok');
