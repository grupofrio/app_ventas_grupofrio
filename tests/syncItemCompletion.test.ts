import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySaleTerminalMarkerDeferral,
  isSaleTerminalMarkerPersistenceError,
  processSyncItemToCompletion,
} from '../src/services/syncItemCompletion.ts';
import { selectPersistableQueue } from '../src/services/syncQueuePersistence.ts';
import type { SyncQueueItem } from '../src/types/sync.ts';

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

test('a remote processing error keeps its identity and is not tagged as a marker failure', async () => {
  const remoteError = new Error('remote sale failed');
  let caught: unknown;

  await assert.rejects(
    processSyncItemToCompletion({
      item: saleItem,
      process: async () => { throw remoteError; },
      markSaleReadyToContinue: async () => true,
      markDone: () => { throw new Error('markDone must not run'); },
    }),
    (error) => {
      caught = error;
      return true;
    },
  );

  assert.strictEqual(caught, remoteError);
  assert.equal(isSaleTerminalMarkerPersistenceError(caught), false);
});

test('a failed marker is tagged with operation id and cause and prevents done', async () => {
  const events: string[] = [];
  const markerCause = new Error('marker storage failed');
  let caught: unknown;

  await assert.rejects(processSyncItemToCompletion({
    item: saleItem,
    process: async () => { events.push('process'); },
    markSaleReadyToContinue: async () => {
      events.push('marker');
      throw markerCause;
    },
    markDone: () => { events.push('done'); },
  }), (error) => {
    caught = error;
    return true;
  });

  assert(isSaleTerminalMarkerPersistenceError(caught));
  assert.equal(caught.name, 'SaleTerminalMarkerPersistenceError');
  assert.equal(caught.operationId, saleItem.id);
  assert.strictEqual(caught.cause, markerCause);
  assert.deepEqual(events, ['process', 'marker']);
});

test('a hostile unknown remote error cannot make the marker guard throw', () => {
  const hostile = new Proxy({}, {
    get() { throw new Error('hostile get'); },
    getPrototypeOf() { throw new Error('hostile prototype'); },
  });

  assert.doesNotThrow(() => isSaleTerminalMarkerPersistenceError(hostile));
  assert.equal(isSaleTerminalMarkerPersistenceError(hostile), false);
});

test('marker deferral resets its local budget without killing dependent photos', () => {
  const retryAt = Date.now() + 2_000;
  const sale: SyncQueueItem = {
    id: saleItem.id,
    type: 'sale_order',
    payload: { amount_total: 100 },
    status: 'syncing',
    created_at: 1,
    retries: 99,
    error_message: 'old remote failure',
    priority: 1,
    next_retry_at: null,
  };
  const photo: SyncQueueItem = {
    id: 'photo-dependent',
    type: 'photo',
    payload: { localUri: 'file:///photo.jpg' },
    status: 'pending',
    created_at: 2,
    retries: 0,
    error_message: null,
    priority: 2,
    next_retry_at: null,
    dependsOn: [sale.id],
  };
  const unrelated: SyncQueueItem = {
    ...sale,
    id: 'sale-unrelated',
    status: 'error',
    retries: 2,
  };

  let queue = [sale, photo, unrelated];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    queue = applySaleTerminalMarkerDeferral(queue, sale.id, retryAt + attempt);
  }

  const deferredSale = queue[0];
  assert.equal(deferredSale.status, 'error');
  assert.equal(deferredSale.error_message, 'sale terminal marker persistence deferred (storage)');
  assert.equal(deferredSale.retries, 0);
  assert.equal(deferredSale.next_retry_at, retryAt + 6);
  assert(deferredSale.next_retry_at > Date.now());
  assert.strictEqual(queue[1], photo);
  assert.strictEqual(queue[2], unrelated);
  assert.equal(queue[1].status, 'pending');
  assert.deepEqual(selectPersistableQueue(queue), queue);
  assert.doesNotThrow(() => JSON.stringify(queue));
});

test('the next duplicate success can persist the marker and complete normally', async () => {
  const events: string[] = [];
  const markerCause = new Error('marker unavailable once');
  let markerAttempts = 0;
  const run = () => processSyncItemToCompletion({
    item: saleItem,
    process: async () => { events.push('remote-duplicate-success'); },
    markSaleReadyToContinue: async () => {
      markerAttempts += 1;
      events.push(`marker-${markerAttempts}`);
      if (markerAttempts === 1) throw markerCause;
      return true;
    },
    markDone: () => { events.push('done'); },
  });

  await assert.rejects(run(), (error) => {
    assert(isSaleTerminalMarkerPersistenceError(error));
    assert.strictEqual(error.cause, markerCause);
    return true;
  });
  await run();

  assert.deepEqual(events, [
    'remote-duplicate-success',
    'marker-1',
    'remote-duplicate-success',
    'marker-2',
    'done',
  ]);
});

test('a false marker result still completes when the matching visit is no longer active', async () => {
  const events: string[] = [];

  await processSyncItemToCompletion({
    item: saleItem,
    process: async () => { events.push('remote-duplicate-success'); },
    markSaleReadyToContinue: async () => {
      events.push('marker-inactive');
      return false;
    },
    markDone: () => { events.push('done'); },
  });

  assert.deepEqual(events, ['remote-duplicate-success', 'marker-inactive', 'done']);
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
