import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const guard = read('src/services/dayBundleMutationGate.ts');
const sale = read('app/sale/[stopId].tsx');
const checkout = read('app/checkout/[stopId].tsx');
const customer = read('app/customer/[partnerId].tsx');
const incidents = read('src/services/routeIncidents.ts');
const sync = read('src/stores/useSyncStore.ts');

assert.match(guard, /loadCurrentEmployeeDayBundle/);
assert.match(guard, /canRunActions/);
assert.match(sale, /assertCurrentEmployeeDayBundleAllowsActions/);
assert.match(checkout, /assertCurrentEmployeeDayBundleAllowsActions/);
assert.match(customer, /assertCurrentEmployeeDayBundleAllowsActions/);
assert.match(incidents, /assertCurrentEmployeeDayBundleAllowsActions/);
assert.match(sync, /assertCurrentEmployeeDayBundleAllowsActions/);

for (const [name, source, start, action] of [
  ['sale', sale, 'async function handleConfirm()', 'createSale'],
  ['checkout', checkout, 'async function handleCheckout', 'enqueueCheckout'],
  ['customer edit', customer, 'async function doSave()', 'enqueue'],
  ['incident', incidents, 'export async function createIncident', 'createEmployeeIncident'],
]) {
  const body = source.slice(source.indexOf(start));
  assert(body.indexOf('assertCurrentEmployeeDayBundleAllowsActions') < body.indexOf(action), `${name} gate must precede mutation/enqueue`);
}

console.log('day bundle mutation gates: ok');
