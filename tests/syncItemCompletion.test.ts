import assert from 'node:assert/strict';
import test from 'node:test';

import { processSyncItemToCompletion } from '../src/services/syncItemCompletion.ts';

const saleItem = { id: 'sale-sync-1', type: 'sale_order' } as const;

test('sale completion is ordered process then durable marker then done', async () => {
  const events: string[] = [];

  await processSyncItemToCompletion({
    item: saleItem,
    process: async () => { events.push('process'); },
    markSaleReadyToContinue: async () => {
      events.push('marker');
      return true;
    },
    markDone: () => { events.push('done'); },
  });

  assert.deepEqual(events, ['process', 'marker', 'done']);
});

test('a failed marker prevents done and the next idempotent attempt can complete', async () => {
  const events: string[] = [];
  let markerAttempts = 0;
  const run = () => processSyncItemToCompletion({
    item: saleItem,
    process: async () => { events.push('process'); },
    markSaleReadyToContinue: async () => {
      markerAttempts += 1;
      events.push(`marker-${markerAttempts}`);
      if (markerAttempts === 1) throw new Error('marker storage failed');
      return true;
    },
    markDone: () => { events.push('done'); },
  });

  await assert.rejects(run(), /marker storage failed/);
  assert.deepEqual(events, ['process', 'marker-1']);

  await run();
  assert.deepEqual(events, ['process', 'marker-1', 'process', 'marker-2', 'done']);
});

test('non-sale items do not require a visit marker', async () => {
  const events: string[] = [];

  await processSyncItemToCompletion({
    item: { id: 'photo-1', type: 'photo' },
    process: async () => { events.push('process'); },
    markSaleReadyToContinue: async () => {
      events.push('marker');
      return false;
    },
    markDone: () => { events.push('done'); },
  });

  assert.deepEqual(events, ['process', 'done']);
});
