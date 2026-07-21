import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/stores/useSyncStore.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

function block(pattern, label) {
  const matched = source.match(pattern)?.[0] ?? '';
  assert.notEqual(matched, '', `${label}: source block must exist`);
  return matched;
}

function assertOrdered(haystack, needles, label) {
  let previous = -1;
  for (const needle of needles) {
    const index = typeof needle === 'string'
      ? haystack.indexOf(needle)
      : haystack.search(needle);
    assert(index >= 0, `${label}: missing ${String(needle)}`);
    assert(index > previous, `${label}: ${String(needle)} must appear in order`);
    previous = index;
  }
}

assert.match(
  source,
  /import \{ applySyncEnqueue \} from ['"]\.\.\/services\/syncEnqueue['"];/,
  'store delegates queue identity/idempotency to the pure enqueue helper',
);
assert.match(
  source,
  /import \{ createSyncProcessingHolds \} from ['"]\.\.\/services\/syncProcessingHolds['"];/,
  'store imports the processing hold registry factory',
);
assert.match(
  source,
  /const processingHolds = createSyncProcessingHolds\(\);[\s\S]*?export const useSyncStore = create/,
  'one processing hold registry is created at module scope, outside Zustand state',
);
assert.match(
  source,
  /opts\?: SyncEnqueueOptions/,
  'enqueue public signature uses SyncEnqueueOptions',
);
assert.match(
  source,
  /releaseProcessingHolds: \(ids: string\[\]\) => void;/,
  'store exposes releaseProcessingHolds',
);

const enqueueBlock = block(
  /enqueue: \(type, payload, opts\) => \{[\s\S]*?\n  \},\n\n  \/\/ ═══ Status transitions/,
  'enqueue',
);
assertOrdered(enqueueBlock, [
  /const generatedId = uuid\(\);/,
  /const createdAt = Date\.now\(\);/,
  /let result = applySyncEnqueue\(\{/,
  /if \(result\.action === ['"]inserted['"] && type === ['"]gps['"]\)/,
  /pickGpsOverflowVictim\(/,
], 'enqueue resolves idempotency before GPS-cap eviction');
assert.match(
  enqueueBlock,
  /result = applySyncEnqueue\(\{[\s\S]*?generatedId,[\s\S]*?createdAt,[\s\S]*?\}\);/,
  'GPS eviction recalculation reuses the same generated id and timestamp',
);
assertOrdered(enqueueBlock, [
  /if \(opts\?\.holdProcessing\)/,
  /processingHolds\.hold\(\[result\.id\]\);/,
  /set\(\{ queue: result\.queue/,
], 'hold is registered before a changed queue is published');
assert.match(
  enqueueBlock,
  /if \(result\.action !== ['"]reused['"]\)[\s\S]*?set\(\{ queue: result\.queue/,
  'reused operations keep the original queue identity while still reaching the hold call',
);
assert.match(
  enqueueBlock,
  /if \(result\.action === ['"]inserted['"]\)[\s\S]*?makeClientEventMeta\(result\.id\)/,
  'client metadata is generated only for new insertions',
);
assert.match(
  enqueueBlock,
  /if \(!opts\?\.holdProcessing && get\(\)\.isOnline && !get\(\)\.isSyncing\)/,
  'holdProcessing suppresses the enqueue auto-trigger explicitly',
);

const releaseBlock = block(
  /releaseProcessingHolds: \(ids\) => \{[\s\S]*?\n  \},/,
  'releaseProcessingHolds',
);
assert.match(releaseBlock, /processingHolds\.release\(ids\);/);
assert.doesNotMatch(
  releaseBlock,
  /processQueue|setTimeout|scheduleWake/,
  'release only releases; it never starts processing',
);

const processQueueBlock = block(
  /processQueue: async \(\) => \{[\s\S]*?\n  \},\n\n  \/\/ ═══ PR-1: Backoff wake timer/,
  'processQueue',
);
assert.match(
  processQueueBlock,
  /const candidates = processingHolds\.withoutHeld\(queue\)\.filter\(isReady\);/,
  'initial candidates exclude held ids before readiness checks',
);
assert.match(
  processQueueBlock,
  /queue: processingHolds\.withoutHeld\(get\(\)\.queue\),/,
  'post-cycle decisions receive a held-filtered queue',
);

const oneItemBlock = block(
  /async function processOneItem\([\s\S]*?\n\}\n\n\/\/ ═══ GPS Batch Processor/,
  'processOneItem',
);
assertOrdered(oneItemBlock, [
  /if \(processingHolds\.isHeld\(item\.id\)\)/,
  /logInfo\(['"]sync['"], ['"]processing_hold_wait['"]/,
  /return ['"]dependency_wait['"];/,
  /if \(isLegacyRefillUnloadItem\(item\)\)/,
  /if \(!areSyncDependenciesSatisfied\(/,
  /status: ['"]syncing['"] as SyncItemStatus/,
  /await processSyncItem\(item\);/,
], 'per-item race guard runs before dependencies, syncing, and dispatch');

const gpsBlock = block(
  /async function processGpsBatch\([\s\S]*?\n\}\n\n\/\*\* Try the dedicated GPS batch endpoint/,
  'processGpsBatch',
);
assertOrdered(gpsBlock, [
  /for \(const chunk of chunks\)/,
  /const dispatchChunk = processingHolds\.withoutHeld\(chunk\);/,
  /if \(dispatchChunk\.length === 0\) continue;/,
  /const ids = new Set\(dispatchChunk\.map\(/,
  /status: ['"]syncing['"] as SyncItemStatus/,
  /await tryGpsBatchCreate\(dispatchChunk\);/,
], 'each GPS chunk is re-filtered immediately before marking and dispatch');
assert.doesNotMatch(
  gpsBlock,
  /tryGpsBatchCreate\(chunk\)|for \(const item of chunk\)|processed \+= chunk\.length/,
  'GPS result bookkeeping and dispatch never use the stale unfiltered chunk',
);

const wakeBlock = block(
  /scheduleWake: \(\) => \{[\s\S]*?\n  \},\n\n  clearWakeTimer:/,
  'scheduleWake',
);
assert.match(
  wakeBlock,
  /nextWakeDelayMs\(processingHolds\.withoutHeld\(queue\),/,
  'wake delay ignores held retryable items',
);

// Concrete race (a): enqueue can reuse an existing pending sale without changing
// queue identity. The hold call is unconditional on action, and the in-flight
// snapshot reaches the fresh per-item guard before any side effect.
assertOrdered(enqueueBlock, [
  /let result = applySyncEnqueue\(/,
  /if \(opts\?\.holdProcessing\)/,
  /processingHolds\.hold\(\[result\.id\]\);/,
  /if \(result\.action !== ['"]reused['"]\)/,
], 'reused pending sale race');
assert(oneItemBlock.indexOf('processingHolds.isHeld(item.id)') < oneItemBlock.indexOf('processSyncItem(item)'),
  'a snapshotted reused sale is stopped before dispatch');

// Concrete race (b): GPS bypasses processOneItem, so a GPS held after the cycle
// snapshot must be removed inside each chunk, after chunking and before syncing.
assert(gpsBlock.indexOf('processingHolds.withoutHeld(chunk)') > gpsBlock.indexOf('for (const chunk of chunks)'),
  'GPS is rechecked after the stale snapshot has already been chunked');
assert(gpsBlock.indexOf('processingHolds.withoutHeld(chunk)') < gpsBlock.indexOf("status: 'syncing'"),
  'GPS held after snapshot is excluded before status/dispatch side effects');

console.log('sync processing hold wiring tests: ok');
