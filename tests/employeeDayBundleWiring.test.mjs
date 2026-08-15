import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(path), 'utf8');

const dayBundle = read('src/services/employeeDayBundle.ts');
const prepStore = read('src/stores/useRoutePreparationStore.ts');
const offroute = read('src/services/offrouteSearch.ts');
const noSale = read('app/nosale/[stopId].tsx');
const routeStart = read('app/route-start.tsx');

assert.match(dayBundle, /getFieldDataSession/);
assert.match(dayBundle, /loadEncrypted/);
assert.match(dayBundle, /saveEncrypted/);
assert.match(dayBundle, /getEmployeeBearerToken/);
assert.match(dayBundle, /If-None-Match/);

assert.match(prepStore, /useEmployeeDayBundleStore\.getState\(\)\.prepare\(\)/);
assert.match(prepStore, /dayBundle.*canStartRoute|canStartRoute.*dayBundle/s);
assert.match(offroute, /loadCurrentEmployeeDayBundle/);
assert.doesNotMatch(offroute, /directory\/search/);
assert.match(noSale, /useEmployeeDayBundleStore/);
assert.doesNotMatch(noSale, /NO_SALE_REASONS|const COMPETITORS/);
assert.match(routeStart, /useEmployeeDayBundleStore/);
assert.match(routeStart, /canStartRoute/);

console.log('employee day bundle wiring: ok');
