import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type {
  PersistAmbiguousSaleInput,
  PersistAmbiguousSaleResult,
} from '../src/services/saleAmbiguousRecovery';
import type { SyncEnqueueOptions, SyncItemType } from '../src/types/sync';

interface SaleAmbiguousRecoveryModule {
  persistAmbiguousSale: (
    input: PersistAmbiguousSaleInput,
  ) => Promise<PersistAmbiguousSaleResult>;
}

type RecoveryInput = PersistAmbiguousSaleInput;
const inputHasNoProcessor: Extract<keyof RecoveryInput, 'processor' | 'processQueue'> extends never
  ? true
  : never = true;

function baseInput(
  overrides: Partial<PersistAmbiguousSaleInput> = {},
): PersistAmbiguousSaleInput {
  return {
    operationId: 'sale-op-1',
    payload: {
      stop_id: 44,
      partner_id: 501,
      lines: [{ product_id: 7, qty: 2 }],
    },
    customerName: 'Abarrotes Lupita',
    total: 345.5,
    stopId: 44,
    photoUris: ['file://sale-1.jpg', 'file://sale-2.jpg'],
    enqueue: () => {
      throw new Error('enqueue fake is required');
    },
    persistQueue: async () => {},
    releaseProcessingHolds: () => {},
    ...overrides,
  };
}

async function testPersistsCompleteHeldBatchBeforeReleasing(
  module: SaleAmbiguousRecoveryModule,
) {
  const calls: Array<{
    type: SyncItemType;
    payload: Record<string, unknown>;
    opts?: SyncEnqueueOptions;
  }> = [];
  const releases: string[][] = [];
  let resolvePersist!: () => void;
  let persistCalls = 0;
  const persistDeferred = new Promise<void>((resolve) => {
    resolvePersist = resolve;
  });
  const payload = {
    stop_id: 44,
    partner_id: 501,
    lines: [{ product_id: 7, qty: 2 }],
  };

  const pending = module.persistAmbiguousSale(baseInput({
    payload,
    enqueue: (type, enqueuedPayload, opts) => {
      calls.push({ type, payload: enqueuedPayload, opts });
      if (type === 'sale_order') return 'sale-op-1';
      return `photo-${calls.filter((call) => call.type === 'photo').length}`;
    },
    persistQueue: () => {
      persistCalls++;
      assert.equal(calls.length, 3, 'persist starts after sale and every photo are in memory');
      return persistDeferred;
    },
    releaseProcessingHolds: (ids) => {
      releases.push([...ids]);
    },
  }));

  assert.equal(persistCalls, 1);
  assert.equal(releases.length, 0, 'held items stay blocked while persistence is unresolved');
  assert.deepEqual(calls[0], {
    type: 'sale_order',
    payload: {
      ...payload,
      _clientCustomerName: 'Abarrotes Lupita',
      _clientTotal: 345.5,
    },
    opts: {
      operationId: 'sale-op-1',
      holdProcessing: true,
    },
  });
  assert.deepEqual(payload, {
    stop_id: 44,
    partner_id: 501,
    lines: [{ product_id: 7, qty: 2 }],
  }, 'the caller payload is not mutated');
  assert.deepEqual(calls.slice(1), [
    {
      type: 'photo',
      payload: {
        stop_id: 44,
        localUri: 'file://sale-1.jpg',
        image_type: 'sale',
      },
      opts: {
        dependsOn: ['sale-op-1'],
        holdProcessing: true,
      },
    },
    {
      type: 'photo',
      payload: {
        stop_id: 44,
        localUri: 'file://sale-2.jpg',
        image_type: 'sale',
      },
      opts: {
        dependsOn: ['sale-op-1'],
        holdProcessing: true,
      },
    },
  ]);

  resolvePersist();
  const result = await pending;

  assert.deepEqual(result, {
    saleId: 'sale-op-1',
    photoIds: ['photo-1', 'photo-2'],
  });
  assert.deepEqual(releases, [['sale-op-1', 'photo-1', 'photo-2']]);
}

async function testPersistFailureReleasesKnownBatchAndRethrows(
  module: SaleAmbiguousRecoveryModule,
) {
  const cause = new Error('disk full');
  const releases: string[][] = [];
  let resolved = false;
  let photoCount = 0;

  const pending = module.persistAmbiguousSale(baseInput({
    enqueue: (type) => {
      if (type === 'sale_order') return 'sale-op-1';
      photoCount++;
      return `photo-${photoCount}`;
    },
    persistQueue: async () => {
      throw cause;
    },
    releaseProcessingHolds: (ids) => {
      releases.push([...ids]);
    },
  })).then((result) => {
    resolved = true;
    return result;
  });

  await assert.rejects(pending, (error) => error === cause);
  assert.equal(resolved, false, 'a rejected persistence is never reported as success');
  assert.deepEqual(releases, [['sale-op-1', 'photo-1', 'photo-2']]);
}

async function testMismatchedSaleIdReleasesReturnedHoldWithoutPersisting(
  module: SaleAmbiguousRecoveryModule,
) {
  const releases: string[][] = [];
  let persistCalls = 0;

  await assert.rejects(
    module.persistAmbiguousSale(baseInput({
      enqueue: () => 'unexpected-sale-id',
      persistQueue: async () => {
        persistCalls++;
      },
      releaseProcessingHolds: (ids) => {
        releases.push([...ids]);
      },
    })),
    (error) => error instanceof Error
      && error.message === 'La cola no conservó el identificador de la venta.',
  );

  assert.equal(persistCalls, 0);
  assert.deepEqual(releases, [['unexpected-sale-id']]);
}

async function testSynchronousPhotoFailureReleasesOnlyReturnedIds(
  module: SaleAmbiguousRecoveryModule,
) {
  const cause = new Error('photo enqueue failed');
  const releases: string[][] = [];
  let photoCalls = 0;
  let persistCalls = 0;

  await assert.rejects(
    module.persistAmbiguousSale(baseInput({
      enqueue: (type) => {
        if (type === 'sale_order') return 'sale-op-1';
        photoCalls++;
        if (photoCalls === 2) throw cause;
        return 'photo-1';
      },
      persistQueue: async () => {
        persistCalls++;
      },
      releaseProcessingHolds: (ids) => {
        releases.push([...ids]);
      },
    })),
    (error) => error === cause,
  );

  assert.equal(persistCalls, 0);
  assert.deepEqual(releases, [['sale-op-1', 'photo-1']]);
}

function testHasNoDispatchHook() {
  assert.equal(inputHasNoProcessor, true);
  const source = readFileSync(
    new URL('../src/services/saleAmbiguousRecovery.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\bprocessQueue\b/);
  assert.doesNotMatch(source, /\bprocessor\b/);
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/saleAmbiguousRecovery.ts', import.meta.url).pathname
  ) as SaleAmbiguousRecoveryModule;

  await testPersistsCompleteHeldBatchBeforeReleasing(module);
  await testPersistFailureReleasesKnownBatchAndRethrows(module);
  await testMismatchedSaleIdReleasesReturnedHoldWithoutPersisting(module);
  await testSynchronousPhotoFailureReleasesOnlyReturnedIds(module);
  testHasNoDispatchHook();
  console.log('sale ambiguous recovery tests: ok');
}

void main();
