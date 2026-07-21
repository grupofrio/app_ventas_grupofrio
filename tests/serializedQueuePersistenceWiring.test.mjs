import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

function serializedCallbackRanges() {
  const marker = 'runSerializedQueuePersist(async () => {';
  const ranges = [];
  let from = 0;
  while (true) {
    const start = store.indexOf(marker, from);
    if (start === -1) return ranges;
    const openBrace = store.indexOf('{', start);
    let depth = 0;
    let end = openBrace;
    for (; end < store.length; end += 1) {
      if (store[end] === '{') depth += 1;
      if (store[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    assert.ok(end < store.length, 'serialized queue callback must have a closing brace');
    ranges.push([start, end]);
    from = end + 1;
  }
}

assert.doesNotMatch(
  store,
  /storeSave\(STORAGE_KEYS\.SYNC_QUEUE/,
  'SYNC_QUEUE must never use the error-swallowing storeSave helper',
);

assert.match(
  store,
  /import \{ createSerializedTaskRunner \} from '\.\.\/services\/serializedTaskRunner';/,
  'the sync store must import the shared serialized task runner',
);
assert.equal(
  (store.match(/createSerializedTaskRunner\(\)/g) || []).length,
  1,
  'the module must create exactly one serialized queue runner',
);
assert.match(
  store,
  /const runSerializedQueuePersist = createSerializedTaskRunner\(\);/,
  'the one runner must be module-level and shared by every SYNC_QUEUE write',
);

const strictQueueWrites = [...store.matchAll(/storeSaveStrict\(STORAGE_KEYS\.SYNC_QUEUE/g)];
assert.equal(strictQueueWrites.length, 3, 'current persistence plus both migration phases must write strictly');
const runnerRanges = serializedCallbackRanges();
for (const write of strictQueueWrites) {
  assert.ok(
    runnerRanges.some(([start, end]) => start < write.index && write.index < end),
    `strict SYNC_QUEUE write at offset ${write.index} must be inside the one runner callback`,
  );
}

const persistCurrent = blockBetween('function persistCurrentQueue()', 'function persistQueueInBackground');
assert.match(persistCurrent, /return runSerializedQueuePersist\(async \(\) => \{/);
assert.match(
  persistCurrent,
  /const \{ queue \} = useSyncStore\.getState\(\);[\s\S]*selectPersistableQueue\(queue\)[\s\S]*await storeSaveStrict\(STORAGE_KEYS\.SYNC_QUEUE/,
  'persistCurrentQueue must read and select queue state only when its serialized callback runs',
);

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
assert.match(markMigration, /return runSerializedQueuePersist\(async \(\) => \{/);
assert.match(
  markMigration,
  /const marked = get\(\)\.queue\.map[\s\S]*await storeSaveStrict\(STORAGE_KEYS\.SYNC_QUEUE[\s\S]*const currentMarked = get\(\)\.queue\.map[\s\S]*set\(\{ queue: currentMarked/,
  'mark migration must transform turn-time state, then reapply the idempotent mark after await',
);

const removeMigration = blockBetween('removeAndPersist:', 'onPhaseError:');
assert.match(removeMigration, /return runSerializedQueuePersist\(async \(\) => \{/);
assert.match(
  removeMigration,
  /const kept = get\(\)\.queue\.filter[\s\S]*await storeSaveStrict\(STORAGE_KEYS\.SYNC_QUEUE[\s\S]*const currentKept = get\(\)\.queue\.filter[\s\S]*queue: currentKept/,
  'remove migration must transform turn-time state, then reapply removal after await without dropping new items',
);

console.log('serialized queue persistence wiring tests: ok');
