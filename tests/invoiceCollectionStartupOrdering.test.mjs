import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const layout = readFileSync(resolve('app/_layout.tsx'), 'utf8');
const rehydrate = readFileSync(resolve('src/services/rehydrate.ts'), 'utf8');
const connectivity = readFileSync(resolve('src/services/connectivity.ts'), 'utf8');
const syncStore = readFileSync(resolve('src/stores/useSyncStore.ts'), 'utf8');
const collectionSync = readFileSync(resolve('src/services/invoiceCollectionSync.ts'), 'utf8');

test('production startup establishes conservative connectivity before critical rehydration', () => {
  const startIndex = layout.indexOf('startConnectivityMonitor()');
  const checkIndex = layout.indexOf('await checkConnectivity()');
  const rehydrateIndex = layout.indexOf('await rehydrateAppState()');
  const collectionWakeIndex = layout.indexOf('requestInvoiceCollectionSync()');

  assert(startIndex >= 0);
  assert(checkIndex > startIndex);
  assert(rehydrateIndex > checkIndex);
  assert(collectionWakeIndex > rehydrateIndex);
  assert.doesNotMatch(layout, /await requestInvoiceCollectionSync\(\)/);
  assert.doesNotMatch(rehydrate, /bootstrapInvoiceCollectionSync|requestInvoiceCollectionSync/);
});

test('unknown connectivity is offline-safe until reachability is confirmed', () => {
  assert.match(syncStore, /isOnline:\s*false/);
  assert.match(connectivity, /isConfirmedOnline\(state\)/);
  assert.doesNotMatch(connectivity, /isInternetReachable !== false/);
});

test('startup and connectivity wake target the same lazy collection singleton', () => {
  const request = collectionSync.slice(
    collectionSync.indexOf('export function requestInvoiceCollectionSync'),
    collectionSync.indexOf('export function resetInvoiceCollectionSync'),
  );
  assert.match(request, /currentProductionRuntime\(\)\.requestReconnect\(\)/);
  assert.match(request, /\.catch\(/);
  assert.doesNotMatch(request, /productionRuntime\?\./);
  assert.match(connectivity, /requestInvoiceCollectionSync\(\)/);
});
