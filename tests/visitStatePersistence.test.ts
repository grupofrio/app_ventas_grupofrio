import assert from 'node:assert/strict';
import test from 'node:test';

import { createVisitStatePersistenceCoordinator } from '../src/services/visitStatePersistence.ts';

interface TestVisitState {
  saleConfirmed: boolean;
  saleOperationId: string | null;
  saleReadyToContinue: boolean;
  saleRecoveryPersistenceFailed: boolean;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHarness(initial: TestVisitState) {
  let state = { ...initial };
  const writes: TestVisitState[] = [];
  let write = async (snapshot: TestVisitState) => {
    writes.push({ ...snapshot });
  };
  const coordinator = createVisitStatePersistenceCoordinator({
    read: () => state,
    selectSnapshot: (current) => ({ ...current }),
    save: (snapshot) => write(snapshot),
    remove: async () => undefined,
    publishSaleRecovery: (patch) => {
      state = { ...state, ...patch };
    },
  });

  return {
    coordinator,
    getState: () => state,
    setState: (patch: Partial<TestVisitState>) => {
      state = { ...state, ...patch };
    },
    setWrite: (next: typeof write) => {
      write = next;
    },
    writes,
  };
}

const activeSale: TestVisitState = {
  saleConfirmed: true,
  saleOperationId: 'sale-current',
  saleReadyToContinue: false,
  saleRecoveryPersistenceFailed: false,
};

test('a queued background write cannot overwrite the terminal marker', async () => {
  const harness = createHarness(activeSale);
  const firstWriteStarted = deferred<void>();
  const releaseFirstWrite = deferred<void>();
  let writeCount = 0;
  harness.setWrite(async (snapshot) => {
    harness.writes.push({ ...snapshot });
    writeCount += 1;
    if (writeCount === 1) {
      firstWriteStarted.resolve();
      await releaseFirstWrite.promise;
    }
  });

  const backgroundWrite = harness.coordinator.persistCurrent();
  await firstWriteStarted.promise;
  const markerWrite = harness.coordinator.markSaleReadyToContinue('sale-current');

  releaseFirstWrite.resolve();
  await backgroundWrite;
  assert.equal(await markerWrite, true);
  assert.deepEqual(
    harness.writes.map((snapshot) => snapshot.saleReadyToContinue),
    [false, true],
  );
  assert.equal(harness.getState().saleReadyToContinue, true);
});

test('the terminal marker publishes only after a successful strict write', async () => {
  const blockedSale = {
    ...activeSale,
    saleRecoveryPersistenceFailed: true,
  };
  const harness = createHarness(blockedSale);
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  harness.setWrite(async (snapshot) => {
    harness.writes.push({ ...snapshot });
    writeStarted.resolve();
    await releaseWrite.promise;
  });

  const markerWrite = harness.coordinator.markSaleReadyToContinue(
    'sale-current',
    { clearOperationId: true },
  );
  await writeStarted.promise;
  assert.deepEqual(harness.getState(), blockedSale);

  releaseWrite.resolve();
  assert.equal(await markerWrite, true);
  assert.equal(harness.getState().saleReadyToContinue, true);
  assert.equal(harness.getState().saleOperationId, null);
  assert.equal(harness.getState().saleRecoveryPersistenceFailed, false);
});

test('the terminal marker returns false when the active visit changes during its write', async () => {
  const harness = createHarness(activeSale);
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  harness.setWrite(async (snapshot) => {
    harness.writes.push({ ...snapshot });
    writeStarted.resolve();
    await releaseWrite.promise;
  });

  const markerWrite = harness.coordinator.markSaleReadyToContinue(
    'sale-current',
    { clearOperationId: true },
  );
  await writeStarted.promise;
  const replacementVisit = {
    ...activeSale,
    saleConfirmed: false,
    saleOperationId: null,
  };
  harness.setState(replacementVisit);
  releaseWrite.resolve();

  assert.equal(await markerWrite, false);
  assert.deepEqual(harness.getState(), replacementVisit);
  assert.equal(harness.writes[0].saleReadyToContinue, true);
});

test('a failed terminal write does not publish ready or clear the operation id', async () => {
  const harness = createHarness(activeSale);
  const failure = new Error('storage unavailable');
  harness.setWrite(async () => {
    throw failure;
  });

  await assert.rejects(
    harness.coordinator.markSaleReadyToContinue(
      'sale-current',
      { clearOperationId: true },
    ),
    failure,
  );
  assert.deepEqual(harness.getState(), activeSale);
});

test('a marker for an old sale leaves the active visit untouched', async () => {
  const harness = createHarness(activeSale);

  assert.equal(
    await harness.coordinator.markSaleReadyToContinue('sale-historical'),
    false,
  );
  assert.deepEqual(harness.getState(), activeSale);
  assert.deepEqual(harness.writes, []);
});

test('an unconfirmed visit cannot be marked terminal even with the same id', async () => {
  const unconfirmedSale = { ...activeSale, saleConfirmed: false };
  const harness = createHarness(unconfirmedSale);

  assert.equal(
    await harness.coordinator.markSaleReadyToContinue('sale-current'),
    false,
  );
  assert.deepEqual(harness.getState(), unconfirmedSale);
  assert.deepEqual(harness.writes, []);
});

test('the durable lock barrier waits behind an older background write', async () => {
  const harness = createHarness(activeSale);
  const firstWriteStarted = deferred<void>();
  const releaseFirstWrite = deferred<void>();
  const events: string[] = [];
  let writeCount = 0;
  harness.setWrite(async (snapshot) => {
    harness.writes.push({ ...snapshot });
    writeCount += 1;
    events.push(`write-${writeCount}-start`);
    if (writeCount === 1) {
      firstWriteStarted.resolve();
      await releaseFirstWrite.promise;
    }
    events.push(`write-${writeCount}-end`);
  });

  const backgroundWrite = harness.coordinator.persistCurrent();
  await firstWriteStarted.promise;
  const lockBarrier = harness.coordinator.persistSaleConfirmationLock('sale-current');
  assert.deepEqual(events, ['write-1-start']);

  releaseFirstWrite.resolve();
  await backgroundWrite;
  assert.equal(await lockBarrier, true);
  assert.deepEqual(events, [
    'write-1-start',
    'write-1-end',
    'write-2-start',
    'write-2-end',
  ]);
  assert.deepEqual(
    harness.writes.map((snapshot) => snapshot.saleOperationId),
    ['sale-current', 'sale-current'],
  );
});

test('the durable lock barrier rejects stale or already-terminal sale state', async () => {
  const staleHarness = createHarness(activeSale);
  assert.equal(
    await staleHarness.coordinator.persistSaleConfirmationLock('sale-old'),
    false,
  );
  assert.deepEqual(staleHarness.writes, []);

  const terminalHarness = createHarness({
    ...activeSale,
    saleReadyToContinue: true,
  });
  assert.equal(
    await terminalHarness.coordinator.persistSaleConfirmationLock('sale-current'),
    false,
  );
  assert.deepEqual(terminalHarness.writes, []);
});
