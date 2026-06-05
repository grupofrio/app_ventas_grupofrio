import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

function main() {
  const syncStore = readFileSync(
    resolve(REPO_ROOT, 'src/stores/useSyncStore.ts'),
    'utf8',
  );
  const syncBar = readFileSync(
    resolve(REPO_ROOT, 'src/components/ui/SyncBar.tsx'),
    'utf8',
  );

  assert.match(
    syncStore,
    /export function isUserVisibleSyncItem[\s\S]*item\.type !== 'gps'/,
    'GPS queue items must be classified as telemetry, not user-visible pending sync',
  );

  const computeCountsBlock = syncStore.match(/function computeCounts[\s\S]*?\n}/)?.[0] ?? '';
  assert.match(
    computeCountsBlock,
    /filter\(isUserVisibleSyncItem\)/,
    'Visible pending/error/dead counters must ignore GPS telemetry items',
  );

  assert.match(
    syncStore,
    /export function hasUserVisibleSyncing[\s\S]*isUserVisibleSyncItem/,
    'Syncing indicator must be derived from non-GPS queue items',
  );
  assert.doesNotMatch(
    syncStore,
    /if \(online && get\(\)\.pendingCount > 0\)/,
    'Reconnect processing must still run when only GPS telemetry is pending',
  );

  assert.match(
    syncBar,
    /hasUserVisibleSyncing\(queue\)/,
    'SyncBar must not show the syncing banner for GPS-only processing',
  );
  assert.doesNotMatch(
    syncBar,
    /const \{[^}]*isSyncing[^}]*\} = useSyncStore\(\)/,
    'SyncBar must not read the global isSyncing flag directly',
  );

  console.log('gps sync visibility tests: ok');
}

main();
