import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import { canConfirmLiquidation } from '../src/services/cashcloseGuard.ts';
import {
  countCloseBlockingSyncItems,
  shouldExposeCloseSyncing,
} from '../src/services/closeSyncBlockers.ts';
import {
  dropSilentGpsItems,
  GPS_MAX_ATTEMPTS,
  GPS_STALE_MS,
  shouldSilentlyDropGpsItem,
  type GpsQueueCandidate,
} from '../src/services/gpsTelemetryQueue.ts';
import { canCloseRoute } from '../src/services/routeCloseGuard.ts';

const root = resolve();
const NOW = Date.parse('2026-10-10T18:00:00Z');

function gps(partial: Record<string, unknown>) {
  return {
    id: 'gps-1',
    type: 'gps',
    status: 'pending',
    retries: 0,
    created_at: NOW - 60_000,
    ...partial,
  };
}

test('a fresh GPS ping is kept and retried; dead, exhausted, and stale pings drop', () => {
  assert.equal(shouldSilentlyDropGpsItem(gps({}), NOW), false);
  assert.equal(shouldSilentlyDropGpsItem(gps({ status: 'error', retries: GPS_MAX_ATTEMPTS - 1 }), NOW), false);
  assert.equal(shouldSilentlyDropGpsItem(gps({ status: 'dead', retries: 1 }), NOW), true);
  assert.equal(shouldSilentlyDropGpsItem(gps({ retries: GPS_MAX_ATTEMPTS }), NOW), true);
  assert.equal(
    shouldSilentlyDropGpsItem(gps({ created_at: NOW - GPS_STALE_MS - 1 }), NOW),
    true,
  );
  assert.equal(shouldSilentlyDropGpsItem(gps({ status: 'done', retries: 9 }), NOW), false);
  assert.equal(shouldSilentlyDropGpsItem({ ...gps({ status: 'dead' }), type: 'sale_order' }, NOW), false);
});

test('dropping GPS releases a check-in that was waiting on the ping and leaves the sale', () => {
  const queue: GpsQueueCandidate[] = [
    gps({ id: 'ping', status: 'dead', created_at: NOW }),
    {
      id: 'checkin-1',
      type: 'checkin',
      status: 'pending',
      retries: 0,
      created_at: NOW,
      dependsOn: ['ping'],
    },
    {
      id: 'sale-1',
      type: 'sale_order',
      status: 'error',
      retries: 1,
      created_at: NOW,
    },
  ];
  const cleaned = dropSilentGpsItems(queue, NOW);

  assert.deepEqual(cleaned.droppedIds, ['ping']);
  assert.equal(cleaned.queue.some((item) => item.type === 'gps'), false);
  const checkin = cleaned.queue.find((item) => item.id === 'checkin-1');
  assert.equal(checkin?.dependsOn, undefined);
  assert.equal(cleaned.queue.some((item) => item.id === 'sale-1'), true);
});

test('46 dead GPS pings do not gate liquidation or route close', () => {
  const queue = Array.from({ length: 46 }, (_, index) => gps({
    id: `ping-${index}`,
    status: index % 2 === 0 ? 'dead' : 'error',
    retries: GPS_MAX_ATTEMPTS,
  }));
  queue.push(gps({ id: 'fresh', status: 'pending', retries: 0 }));
  const counts = countCloseBlockingSyncItems(queue);
  assert.deepEqual(counts, { pendingCount: 0, errorCount: 0, deadCount: 0 });
  assert.equal(canConfirmLiquidation({ ...counts, isSyncing: false, liquidationAvailable: true }), true);
  assert.equal(canCloseRoute({ ...counts, isSyncing: false }), true);
  assert.equal(shouldExposeCloseSyncing(queue.map((item) => ({ type: item.type }))), false);

  const withSale = countCloseBlockingSyncItems([
    ...queue,
    { type: 'sale_order', status: 'dead' },
    { type: 'payment', status: 'pending' },
    { type: 'gift', status: 'error' },
    { type: 'checkin', status: 'pending' },
    { type: 'checkout', status: 'error' },
    { type: 'photo', status: 'dead' },
  ]);
  assert.equal(withSale.pendingCount, 2);
  assert.equal(withSale.errorCount, 2);
  assert.equal(withSale.deadCount, 2);
  assert.equal(canConfirmLiquidation({ ...withSale, isSyncing: false, liquidationAvailable: true }), false);
});

test('GPS failures are dropped on startup and never marked dead for the seller', () => {
  const syncStore = readFileSync(resolve(root, 'src/stores/useSyncStore.ts'), 'utf8');
  const syncScreen = readFileSync(resolve(root, 'app/sync.tsx'), 'utf8');
  const handler = syncStore.match(/function handleGpsItemError[\s\S]*?\n}/)?.[0] ?? '';
  const processAt = syncStore.indexOf('processQueue: async');
  const dropAt = syncStore.indexOf('dropSilentGpsItems', processAt);
  const cascadeAt = syncStore.indexOf('failDependentsOfDeadParents', processAt);

  assert.match(handler, /shouldSilentlyDropGpsItem/);
  assert.match(handler, /markError/);
  assert.doesNotMatch(handler, /markDead/);
  assert.ok(dropAt > processAt && dropAt < cascadeAt, 'dead GPS is removed before a dead parent can kill a check-in');
  assert.match(syncStore, /reason: 'rehydrate'/);
  assert.match(syncScreen, /visibleErrors = errors\.filter\(\(i\) => i\.type !== 'lead_note'\)\.filter\(\(i\) => i\.type !== 'gps'\)/);
  assert.match(syncScreen, /visibleDead = dead\.filter\(\(i\) => i\.type !== 'lead_note'\)\.filter\(\(i\) => i\.type !== 'gps'\)/);
});
