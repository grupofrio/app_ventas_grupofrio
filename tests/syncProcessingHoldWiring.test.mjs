import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/stores/useSyncStore.ts', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');

const enqueueRuntime = await import(
  new URL('../src/services/syncEnqueue.ts', import.meta.url).pathname
);
const holdsRuntime = await import(
  new URL('../src/services/syncProcessingHolds.ts', import.meta.url).pathname
);
const wakeRuntime = await import(
  new URL('../src/services/syncWakeup.ts', import.meta.url).pathname
);
const dependenciesRuntime = await import(
  new URL('../src/services/syncDependencies.ts', import.meta.url).pathname
);

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
  /import \{[\s\S]*?createSyncCycleMetrics,[\s\S]*?createSyncProcessingHolds,[\s\S]*?runUnlessProcessingHeld,[\s\S]*?runUnheldProcessingChunk,[\s\S]*?\} from ['"]\.\.\/services\/syncProcessingHolds['"];/,
  'store imports the runtime-tested hold gates and effective metrics accumulator',
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
  /return runUnlessProcessingHeld\(\{/,
  /registry: processingHolds,/,
  /id: item\.id,/,
  /heldResult: ['"]dependency_wait['"] as ProcessItemOutcome,/,
  /onHeld: \(\) => logInfo\(['"]sync['"], ['"]processing_hold_wait['"]/,
  /run: \(\) => processOneItemUnheld\(item, get, set\),/,
  /async function processOneItemUnheld\(/,
  /if \(isLegacyRefillUnloadItem\(item\)\)/,
  /if \(!areSyncDependenciesSatisfied\(/,
  /status: ['"]syncing['"] as SyncItemStatus/,
  /await processSyncItemToCompletion\(\{/,
], 'per-item race guard runs before dependencies, syncing, and dispatch');

const gpsBlock = block(
  /async function processGpsBatch\([\s\S]*?\n\}\n\n\/\*\* Try the dedicated GPS batch endpoint/,
  'processGpsBatch',
);
assertOrdered(gpsBlock, [
  /for \(const chunk of chunks\)/,
  /const chunkResult = await runUnheldProcessingChunk\(\{/,
  /registry: processingHolds,/,
  /items: chunk,/,
  /run: async \(dispatchChunk\) => \{/,
  /const ids = new Set\(dispatchChunk\.map\(/,
  /status: ['"]syncing['"] as SyncItemStatus/,
  /await tryGpsBatchCreate\(dispatchChunk\);/,
], 'each GPS chunk is re-filtered immediately before marking and dispatch');
assert.doesNotMatch(
  gpsBlock,
  /tryGpsBatchCreate\(chunk\)|for \(const item of chunk\)|processed \+= chunk\.length/,
  'GPS result bookkeeping and dispatch never use the stale unfiltered chunk',
);

assertOrdered(processQueueBlock, [
  /const cycleTally = createSyncCycleMetrics\(\);/,
  /cycleTally\.recordOutcome\(item\.priority, outcome\);/,
  /cycleTally\.recordBatch\(3, gpsResult\);/,
  /const cycleCounts = cycleTally\.snapshot\(\);/,
  /items_by_priority: cycleCounts\.itemsByPriority,/,
  /p3_gps: gpsDispatched,/,
], 'cycle metrics use effective runtime dispatch counts');
assert.doesNotMatch(
  processQueueBlock,
  /items_by_priority:\s*\{[\s\S]{0,180}?orderedP1\.length|p3_gps: gpsItems\.length/,
  'selected snapshots are never reported as effective processing metrics',
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
assert(oneItemBlock.indexOf('runUnlessProcessingHeld({') < oneItemBlock.indexOf('processSyncItemToCompletion({'),
  'a snapshotted reused sale is stopped before dispatch');

// Concrete race (b): GPS bypasses processOneItem, so a GPS held after the cycle
// snapshot must be removed inside each chunk, after chunking and before syncing.
assert(gpsBlock.indexOf('runUnheldProcessingChunk({') > gpsBlock.indexOf('for (const chunk of chunks)'),
  'GPS is rechecked after the stale snapshot has already been chunked');
assert(gpsBlock.indexOf('runUnheldProcessingChunk({') < gpsBlock.indexOf("status: 'syncing'"),
  'GPS held after snapshot is excluded before status/dispatch side effects');

function queueItem({ id, type, status = 'pending', payload = {}, priority, retries = 0, nextRetryAt = null }) {
  return {
    id,
    type,
    status,
    payload,
    priority: priority ?? (type === 'gps' ? 3 : 1),
    retries,
    next_retry_at: nextRetryAt,
    error_message: null,
    created_at: 1_000,
  };
}

async function testLateHeldReusedSaleStopsRuntimeDispatchAndMetrics() {
  assert.equal(
    typeof holdsRuntime.runUnlessProcessingHeld,
    'function',
    'runtime per-item hold gate must be exported and shared with the store',
  );
  assert.equal(
    typeof holdsRuntime.createSyncCycleMetrics,
    'function',
    'effective cycle metrics accumulator must be runtime-testable',
  );

  const sale = queueItem({
    id: 'sale-1',
    type: 'sale_order',
    payload: { amount: 25, _operationId: 'sale-1' },
  });
  const queue = [sale];
  const selectedSnapshot = [...queue];
  const holds = holdsRuntime.createSyncProcessingHolds();

  // The cycle has already selected the pending sale. A durability owner then
  // reuses the explicit operation and installs the hold before this snapshot
  // reaches its dispatch point.
  const enqueueResult = enqueueRuntime.applySyncEnqueue({
    queue,
    type: 'sale_order',
    payload: { replacement: true },
    options: { operationId: 'sale-1', holdProcessing: true },
    generatedId: 'unused-generated-id',
    createdAt: 2_000,
  });
  assert.equal(enqueueResult.action, 'reused');
  assert.equal(enqueueResult.queue, queue, 'reuse preserves queue identity');
  holds.hold([enqueueResult.id]);

  let syncingTransitions = 0;
  let processSyncItemCalls = 0;
  const outcome = await holdsRuntime.runUnlessProcessingHeld({
    registry: holds,
    id: selectedSnapshot[0].id,
    heldResult: 'dependency_wait',
    run: async () => {
      syncingTransitions++;
      processSyncItemCalls++;
      return 'handled';
    },
  });

  assert.equal(outcome, 'dependency_wait');
  assert.equal(syncingTransitions, 0, 'late-held sale never transitions to syncing');
  assert.equal(processSyncItemCalls, 0, 'late-held sale never reaches API/processSyncItem');

  const metrics = holdsRuntime.createSyncCycleMetrics();
  metrics.recordOutcome(1, outcome);
  assert.deepEqual(metrics.snapshot(), {
    processed: 0,
    succeeded: 0,
    failed: 0,
    itemsByPriority: { 1: 0, 2: 0, 3: 0 },
  }, 'a processing hold wait is not a processed or failed item');
}

async function testLateHeldReusedGpsIsRemovedFromRuntimeChunkAndMetrics() {
  assert.equal(
    typeof holdsRuntime.runUnheldProcessingChunk,
    'function',
    'runtime GPS chunk gate must be exported and shared with the store',
  );

  const heldGps = queueItem({
    id: 'gps-held',
    type: 'gps',
    payload: { latitude: 1, longitude: 2, _operationId: 'gps-held' },
  });
  const liveGps = queueItem({
    id: 'gps-live',
    type: 'gps',
    payload: { latitude: 3, longitude: 4, _operationId: 'gps-live' },
  });
  const queue = [heldGps, liveGps];
  const selectedSnapshot = [...queue];
  const holds = holdsRuntime.createSyncProcessingHolds();
  const enqueueResult = enqueueRuntime.applySyncEnqueue({
    queue,
    type: 'gps',
    payload: { latitude: 99, longitude: 99 },
    options: { operationId: 'gps-held', holdProcessing: true },
    generatedId: 'unused-generated-id',
    createdAt: 2_000,
  });
  assert.equal(enqueueResult.action, 'reused');
  assert.equal(enqueueResult.queue[0].payload, heldGps.payload, 'reused GPS keeps durable payload');
  holds.hold([enqueueResult.id]);

  const syncingIds = [];
  const dispatches = [];
  const chunkResult = await holdsRuntime.runUnheldProcessingChunk({
    registry: holds,
    items: selectedSnapshot,
    run: async (dispatchChunk) => {
      syncingIds.push(...dispatchChunk.map((item) => item.id));
      dispatches.push(dispatchChunk.map((item) => ({ id: item.id, payload: item.payload })));
      return { processed: dispatchChunk.length, succeeded: dispatchChunk.length, failed: 0 };
    },
  });

  assert.equal(chunkResult.dispatched, true);
  assert.deepEqual(syncingIds, ['gps-live']);
  assert.deepEqual(dispatches, [[{ id: 'gps-live', payload: liveGps.payload }]],
    'IDs and payloads sent exclude the late-held explicit GPS');

  const metrics = holdsRuntime.createSyncCycleMetrics();
  metrics.recordBatch(3, chunkResult.result);
  assert.deepEqual(metrics.snapshot(), {
    processed: 1,
    succeeded: 1,
    failed: 0,
    itemsByPriority: { 1: 0, 2: 0, 3: 1 },
  }, 'priority-3 metrics count only the effectively dispatched GPS');
}

async function testAllHeldGpsChunkPerformsNoRuntimeSideEffect() {
  const gps = queueItem({
    id: 'gps-only',
    type: 'gps',
    payload: { latitude: 1, longitude: 2, _operationId: 'gps-only' },
  });
  const queue = [gps];
  const selectedSnapshot = [...queue];
  const holds = holdsRuntime.createSyncProcessingHolds();
  const enqueueResult = enqueueRuntime.applySyncEnqueue({
    queue,
    type: 'gps',
    payload: { replacement: true },
    options: { operationId: 'gps-only', holdProcessing: true },
    generatedId: 'unused-generated-id',
    createdAt: 2_000,
  });
  holds.hold([enqueueResult.id]);

  let syncingTransitions = 0;
  let dispatchCalls = 0;
  const chunkResult = await holdsRuntime.runUnheldProcessingChunk({
    registry: holds,
    items: selectedSnapshot,
    run: async (dispatchChunk) => {
      syncingTransitions += dispatchChunk.length;
      dispatchCalls++;
      return { processed: dispatchChunk.length, succeeded: dispatchChunk.length, failed: 0 };
    },
  });

  assert.deepEqual(chunkResult, { dispatched: false, items: [] });
  assert.equal(syncingTransitions, 0);
  assert.equal(dispatchCalls, 0, 'an empty unheld subchunk never calls the GPS API');
}

function testHeldQueueProducesNoRuntimeRedrainOrWakeLoop() {
  const holds = holdsRuntime.createSyncProcessingHolds();
  const pendingSale = queueItem({ id: 'sale-held', type: 'sale_order' });
  const retryingGps = queueItem({
    id: 'gps-retry-held',
    type: 'gps',
    status: 'error',
    retries: 1,
    nextRetryAt: 10_000,
  });
  holds.hold([pendingSale.id, retryingGps.id]);
  const filtered = holds.withoutHeld([pendingSale, retryingGps]);

  const action = wakeRuntime.decidePostCycleActionAfterCycle({
    hadUnhandledCycleError: false,
    hadDeferredStorageFailure: false,
    queue: filtered,
    now: 1_000,
    maxRetries: 3,
    depsSatisfied: dependenciesRuntime.areSyncDependenciesSatisfied,
  });
  const wakeDelay = wakeRuntime.nextWakeDelayMs(filtered, { maxRetries: 3, now: 1_000 });
  let scheduledWakeCalls = 0;
  if (wakeDelay != null) scheduledWakeCalls++;

  assert.equal(action, 'idle', 'held pending work does not request immediate redrain');
  assert.equal(wakeDelay, null, 'held retry work does not arm a wake timer');
  assert.equal(scheduledWakeCalls, 0, 'no wake-loop callback is scheduled');
}

await testLateHeldReusedSaleStopsRuntimeDispatchAndMetrics();
await testLateHeldReusedGpsIsRemovedFromRuntimeChunkAndMetrics();
await testAllHeldGpsChunkPerformsNoRuntimeSideEffect();
testHeldQueueProducesNoRuntimeRedrainOrWakeLoop();

console.log('sync processing hold wiring tests: ok');
