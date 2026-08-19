import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('.');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const rehydrate = read('src/services/rehydrate.ts');
assert.match(rehydrate, /useRoutePreparationStore\.getState\(\)\.hydrate\(\)/);
assert.match(rehydrate, /useEmployeeDayBundleStore\.getState\(\)\.hydrate\(\)/);

const auth = read('src/stores/useAuthStore.ts');
assert.match(auth, /transferRoutePreparationReceiptForReauthentication/);

const store = read('src/stores/useRoutePreparationStore.ts');
assert.match(store, /saveRoutePreparationReceipt/);
assert.match(store, /clearRoutePreparationReceipt/);
assert.match(store, /hydrate: async \(\) =>/);

console.log('route preparation durability wiring tests: ok');
