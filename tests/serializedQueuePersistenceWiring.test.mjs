import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const store = readFileSync(resolve(REPO_ROOT, 'src/stores/useSyncStore.ts'), 'utf8');

function blockBetween(startMarker, endMarker) {
  const start = store.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = store.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker after ${startMarker}: ${endMarker}`);
  return store.slice(start, end);
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

const tolerantQueueWriters = sourceFiles(resolve(REPO_ROOT, 'src')).filter((path) =>
  /storeSave\(STORAGE_KEYS\.SYNC_QUEUE/.test(readFileSync(path, 'utf8')),
);
assert.deepEqual(tolerantQueueWriters, [], 'no source file may use tolerant storeSave for SYNC_QUEUE');

assert.match(
  store,
  /import \{ createSerializedPersistenceCoordinator \} from '\.\.\/services\/serializedTaskRunner';/,
  'the sync store must import the tested persistence coordinator',
);
assert.equal(
  (store.match(/createSerializedPersistenceCoordinator(?:<[^>]+>)?\(\{/g) || []).length,
  1,
  'the store module must create exactly one queue persistence coordinator',
);
assert.match(
  store,
  /const queuePersistence = createSerializedPersistenceCoordinator(?:<[^>]+>)?\(\{/,
  'the queue persistence coordinator must be module-level',
);

const strictQueueWrites = [...store.matchAll(/storeSaveStrict\(STORAGE_KEYS\.SYNC_QUEUE/g)];
assert.equal(strictQueueWrites.length, 1, 'the coordinator must own the only strict SYNC_QUEUE writer');

const coordinatorSetup = blockBetween(
  'const queuePersistence = createSerializedPersistenceCoordinator<SyncQueueItem[], SyncQueueItem[]>({',
  'function persistCurrentQueue()',
);
assert.match(coordinatorSetup, /read: \(\) => useSyncStore\.getState\(\)\.queue/);
assert.match(coordinatorSetup, /select: selectPersistableQueue/);
assert.match(
  coordinatorSetup,
  /write: \(snapshot\) => storeSaveStrict\(STORAGE_KEYS\.SYNC_QUEUE, snapshot\)/,
);
assert.match(coordinatorSetup, /publish: \(queue\) =>[\s\S]*useSyncStore\.setState\(\{[\s\S]*queue/);

const persistCurrent = blockBetween('function persistCurrentQueue()', 'function persistQueueInBackground');
assert.match(persistCurrent, /return queuePersistence\.persistCurrent\(\);/);

const background = blockBetween('function persistQueueInBackground', '// PR-1');
assert.match(
  background,
  /void useSyncStore\.getState\(\)\.persistQueue\(\)\.catch\(\(error/,
  'background writes must consume the public barrier promise so immediate writes still cancel debounce',
);
assert.match(background, /logError\('sync', 'sync_queue_persist_failed', \{[\s\S]*source/);

const publicBarrier = blockBetween('persistQueue: () => {', 'rehydrateQueue: async');
assert.match(publicBarrier, /clearTimeout\(_persistTimer\)/, 'public barrier must still cancel pending debounce');
assert.match(publicBarrier, /return persistCurrentQueue\(\);/, 'public barrier must return the strict serialized promise');
assert.doesNotMatch(publicBarrier, /persistQueueInBackground/, 'public barrier must propagate rejection, not swallow it');

for (const source of [
  'scheduled_writer',
  'enqueue',
  'metadata_completion',
  'process_finally',
  'rollback_marker',
]) {
  assert.match(
    store,
    new RegExp(`persistQueueInBackground\\('${source}'\\)`),
    `fire-and-forget queue persistence from ${source} must use the handled background helper`,
  );
}
assert.doesNotMatch(
  store.replace(background, ''),
  /(?:void\s+)?(?:get\(\)|useSyncStore\.getState\(\))\.persistQueue\(\)\s*;/,
  'no fire-and-forget public persistence promise may be left without an explicit rejection handler',
);

const markMigration = blockBetween('markConsumedAndPersist:', '// 3. reversión local');
assert.match(
  markMigration,
  /return queuePersistence\.transformAndPersist\(\(queue\) =>[\s\S]*queue\.map/,
  'mark migration must pass its real queue transform to the tested coordinator',
);

const removeMigration = blockBetween('removeAndPersist:', 'onPhaseError:');
assert.match(
  removeMigration,
  /await queuePersistence\.transformAndPersist\(\(queue\) =>[\s\S]*queue\.filter/,
  'remove migration must pass its real queue transform to the tested coordinator',
);

console.log('serialized queue persistence wiring tests: ok');
