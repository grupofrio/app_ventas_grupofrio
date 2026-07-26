import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySaleTicketFolioPromotionDeferral,
  applySaleTicketOdooConfirmation,
  applySaleTerminalMarkerDeferral,
  isSaleTicketFolioPromotionPersistenceError,
  isSaleTerminalMarkerPersistenceError,
  processSyncItemToCompletion,
  readSaleTicketOdooConfirmation,
  runSaleTicketFolioPromotion,
  runSaleTicketOdooFolioCompletion,
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

test('a strict folio promotion failure is nominal, preserves its cause, and cannot be forged', async () => {
  const cause = new Error('ticket storage failed');
  let caught: unknown;
  await assert.rejects(
    runSaleTicketFolioPromotion(saleItem.id, 'S00042', async () => { throw cause; }),
    (error) => {
      caught = error;
      return true;
    },
  );

  assert(isSaleTicketFolioPromotionPersistenceError(caught));
  assert.equal(caught.operationId, saleItem.id);
  assert.equal(caught.odooFolio, 'S00042');
  assert.strictEqual(caught.cause, cause);
  assert.equal(isSaleTicketFolioPromotionPersistenceError({
    name: 'SaleTicketFolioPromotionPersistenceError',
    operationId: saleItem.id,
    cause,
  }), false);
});

test('folio promotion deferral preserves the confirmed remote phase through persistence', () => {
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
    id: 'photo-dependent-on-folio',
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
    id: 'sale-unrelated-to-folio',
    status: 'error',
    retries: 2,
  };

  let queue = [sale, photo, unrelated];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    queue = applySaleTicketFolioPromotionDeferral(
      queue,
      sale.id,
      'S00042',
      retryAt + attempt,
    );
  }

  assert.equal(queue[0].status, 'error');
  assert.equal(
    queue[0].error_message,
    'sale ticket folio promotion persistence deferred (storage)',
  );
  assert.equal(queue[0].retries, 0);
  assert.equal(queue[0].next_retry_at, retryAt + 6);
  assert.strictEqual(queue[1], photo);
  assert.strictEqual(queue[2], unrelated);
  assert.equal(queue[1].status, 'pending');
  assert.equal(readSaleTicketOdooConfirmation(queue[0].payload), 'S00042');
  const persisted = structuredClone(selectPersistableQueue(queue));
  assert.equal(readSaleTicketOdooConfirmation(persisted[0].payload), 'S00042');
  assert.doesNotThrow(() => JSON.stringify(persisted));
});

test('remote confirmation parser accepts only the private validated phase shape', () => {
  assert.equal(readSaleTicketOdooConfirmation(undefined), null);
  assert.equal(readSaleTicketOdooConfirmation({ _saleOdooConfirmation: 'S00042' }), null);
  assert.equal(readSaleTicketOdooConfirmation({
    _saleOdooConfirmation: { phase: 'created', odooFolio: '  S00042  ' },
  }), 'S00042');
  assert.equal(readSaleTicketOdooConfirmation({
    _saleOdooConfirmation: { phase: 'wrong', odooFolio: 'S00042' },
  }), null);
  assert.equal(readSaleTicketOdooConfirmation({
    _saleOdooConfirmation: { phase: 'created', odooFolio: '   ' },
  }), null);
});

test('phase persistence failure is nominal and carries the validated remote folio', async () => {
  const cause = new Error('queue storage unavailable');
  let caught: unknown;

  await assert.rejects(
    runSaleTicketOdooFolioCompletion({
      item: { ...saleItem, payload: { amount_total: 100 } },
      createSale: async () => ({ name: ' S00042 ' }),
      persistRemoteConfirmation: async () => { throw cause; },
      promote: async () => 'updated',
    }),
    (error) => {
      caught = error;
      return true;
    },
  );

  assert(isSaleTicketFolioPromotionPersistenceError(caught));
  assert.equal(caught.operationId, saleItem.id);
  assert.equal(caught.odooFolio, 'S00042');
  assert.strictEqual(caught.cause, cause);
});

test('confirmed remote folio survives promotion failure and retry skips create before marker', async () => {
  const promotionCause = new Error('ticket promotion unavailable');
  const retryAt = Date.now() + 2_000;
  const events: string[] = [];
  let createCalls = 0;
  let promotionCalls = 0;
  let queue: SyncQueueItem[] = [{
    id: saleItem.id,
    type: 'sale_order',
    payload: { amount_total: 100 },
    status: 'pending',
    created_at: 1,
    retries: 0,
    error_message: null,
    priority: 1,
    next_retry_at: null,
  }];

  const runAttempt = async () => {
    const current = queue[0];
    await processSyncItemToCompletion({
      item: current,
      process: async (candidate) => {
        await runSaleTicketOdooFolioCompletion({
          item: candidate,
          createSale: async () => {
            createCalls += 1;
            events.push('create');
            if (createCalls > 1) throw new Error('create must not run on retry');
            return { name: 'S00042' };
          },
          persistRemoteConfirmation: async (operationId: string, odooFolio: string) => {
            events.push('persist-confirmation');
            queue = applySaleTicketOdooConfirmation(queue, operationId, odooFolio);
          },
          promote: async (_operationId: string, odooFolio: string) => {
            promotionCalls += 1;
            events.push(`promote-${promotionCalls}-${odooFolio}`);
            if (promotionCalls === 1) throw promotionCause;
            return 'updated';
          },
        });
      },
      markSaleReadyToContinue: async () => {
        events.push('marker');
        return true;
      },
      markDone: () => { events.push('done'); },
    });
  };

  let caught: unknown;
  await assert.rejects(runAttempt(), (error) => {
    caught = error;
    return true;
  });
  assert(isSaleTicketFolioPromotionPersistenceError(caught));
  queue = applySaleTicketFolioPromotionDeferral(
    queue,
    caught.operationId,
    caught.odooFolio,
    retryAt,
  );

  queue = structuredClone(selectPersistableQueue(queue));
  await runAttempt();

  assert.equal(createCalls, 1);
  assert.equal(promotionCalls, 2);
  assert.deepEqual(events, [
    'create',
    'persist-confirmation',
    'promote-1-S00042',
    'promote-2-S00042',
    'marker',
    'done',
  ]);
});

test('create failures before the first remote confirmation preserve their original identity', async () => {
  const createCause = new Error('remote create failed');

  await assert.rejects(
    runSaleTicketOdooFolioCompletion({
      item: { ...saleItem, payload: {} },
      createSale: async () => { throw createCause; },
      persistRemoteConfirmation: async () => {
        throw new Error('persistence must not run');
      },
      promote: async () => {
        throw new Error('promotion must not run');
      },
    }),
    (error) => {
      assert.strictEqual(error, createCause);
      assert.equal(isSaleTicketFolioPromotionPersistenceError(error), false);
      return true;
    },
  );
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
