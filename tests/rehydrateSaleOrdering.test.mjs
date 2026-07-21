import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('queue rehydration never starts processing before visit crash recovery', () => {
  const syncStore = readFileSync(resolve(root, 'src/stores/useSyncStore.ts'), 'utf8');
  const block = syncStore.match(/rehydrateQueue:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\n  \},\n\n  \/\/ ═══ V2/)?.[0] ?? '';

  assert.notEqual(block, '');
  assert.doesNotMatch(block, /scheduleWake\s*\(/);
  assert.doesNotMatch(block, /processQueue\s*\(/);
});

test('app rehydration recovers the persisted sale before its single sync wake', () => {
  const source = readFileSync(resolve(root, 'src/services/rehydrate.ts'), 'utf8');
  const queueIndex = source.indexOf('rehydrateQueue()');
  const visitIndex = source.indexOf('restoreVisit(');
  const recoveryIndex = source.indexOf('recoverPersistedSaleIntent(');
  const wakeMatches = [...source.matchAll(/\.scheduleWake\(\)/g)];

  assert(queueIndex >= 0);
  assert(visitIndex > queueIndex);
  assert(recoveryIndex > visitIndex);
  assert.equal(wakeMatches.length, 1);
  assert(wakeMatches[0].index > recoveryIndex);
});
