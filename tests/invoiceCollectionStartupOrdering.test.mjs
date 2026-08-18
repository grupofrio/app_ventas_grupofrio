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
  const orchestrationIndex = layout.indexOf('runNonblockingAppInitialization({');
  const rehydrateIndex = layout.indexOf('await rehydrateAppState()');

  assert(orchestrationIndex >= 0);
  assert(rehydrateIndex > orchestrationIndex);
  assert.match(layout, /runNonblockingAppInitialization\(\{\s*startConnectivityMonitor,\s*checkConnectivity,/);
  assert.doesNotMatch(layout, /await checkConnectivity\(\)/);
  assert.doesNotMatch(layout, /await requestInvoiceCollectionSync\(\)/);
  assert.doesNotMatch(rehydrate, /bootstrapInvoiceCollectionSync|requestInvoiceCollectionSync/);
});

test('unknown connectivity is offline-safe until reachability is confirmed', () => {
  assert.match(syncStore, /isOnline:\s*false/);
  assert.match(connectivity, /isConfirmedOnline\(state\)/);
  assert.doesNotMatch(connectivity, /isInternetReachable !== false/);
});

test('startup and connectivity wake target the same lazy collection singleton', () => {
  const runtime = collectionSync.slice(
    collectionSync.indexOf('function currentProductionRuntime'),
    collectionSync.indexOf('export async function captureCurrentInvoiceCollection'),
  );
  const request = collectionSync.slice(
    collectionSync.indexOf('export function requestInvoiceCollectionSync'),
    collectionSync.indexOf('export function resetInvoiceCollectionSync'),
  );
  assert.match(request, /currentProductionRuntime\(\)\.requestReconnect\(\)/);
  assert.match(request, /\.catch\(/);
  assert.doesNotMatch(request, /productionRuntime\?\./);
  assert.match(runtime, /import\('\.\.\/stores\/useAuthStore\.ts'\)/);
  assert.match(runtime, /isOnline:\s*\(\)\s*=>\s*useSyncStore\.getState\(\)\.isOnline\s*&&\s*useAuthStore\.getState\(\)\.isAuthenticated/);
  assert.match(connectivity, /requestInvoiceCollectionSync\(\)/);
});
