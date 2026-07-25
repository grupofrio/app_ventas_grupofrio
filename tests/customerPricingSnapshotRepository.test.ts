import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  activatePreparedPricingRun,
  emptyPricingSnapshotState,
  recordLastKnownServerPrices,
  type PricingSnapshotStateV1,
} from '../src/services/customerPricingSnapshot.ts';
import {
  createCustomerPricingSnapshotRepository,
  type PricingSnapshotStorage,
} from '../src/services/customerPricingSnapshotRepository.ts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function activateSingleTarget(
  current: PricingSnapshotStateV1,
  input: {
    runId: string;
    partnerId: number;
    requestedPricelistId: number;
    resolvedPricelistId: number;
    productId: number;
    unitPrice: number;
    capturedAtMs: number;
  },
): PricingSnapshotStateV1 {
  return activatePreparedPricingRun(current, {
    companyId: 3,
    planId: 71,
    preparationRunId: input.runId,
    activatedAtMs: input.capturedAtMs,
    targets: [{
      status: 'prepared',
      partnerId: input.partnerId,
      requestedPricelistId: input.requestedPricelistId,
      snapshot: {
        preparedAtMs: input.capturedAtMs,
        validation: {
          ok: true,
          resolvedPricelistId: input.resolvedPricelistId,
          productFingerprint: String(input.productId),
          prices: [[input.productId, input.unitPrice]],
        },
      },
    }],
  });
}

function recordPrice(
  current: PricingSnapshotStateV1,
  input: {
    runId: string;
    partnerId: number;
    requestedPricelistId: number;
    resolvedPricelistId: number;
    productId: number;
    unitPrice: number;
    capturedAtMs: number;
  },
): PricingSnapshotStateV1 {
  return recordLastKnownServerPrices(current, {
    companyId: 3,
    partnerId: input.partnerId,
    requestedPricelistId: input.requestedPricelistId,
    capturedAtMs: input.capturedAtMs,
    captureRunId: input.runId,
    validation: {
      ok: true,
      resolvedPricelistId: input.resolvedPricelistId,
      productFingerprint: String(input.productId),
      prices: [[input.productId, input.unitPrice]],
    },
  });
}

function assertDeeplyFrozen(state: PricingSnapshotStateV1): void {
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.snapshots), true);
  assert.equal(Object.isFrozen(state.requestedMappings), true);
  assert.equal(Object.isFrozen(state.lastKnownPrices), true);

  if (state.activeManifest) {
    assert.equal(Object.isFrozen(state.activeManifest), true);
    assert.equal(Object.isFrozen(state.activeManifest.targets), true);
    for (const target of state.activeManifest.targets) {
      assert.equal(Object.isFrozen(target), true);
    }
  }

  for (const snapshot of Object.values(state.snapshots)) {
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.prices), true);
    for (const price of snapshot.prices) {
      assert.equal(Object.isFrozen(price), true);
    }
  }

  for (const mapping of Object.values(state.requestedMappings)) {
    assert.equal(Object.isFrozen(mapping), true);
  }

  for (const productPrices of Object.values(state.lastKnownPrices)) {
    assert.equal(Object.isFrozen(productPrices), true);
    for (const price of Object.values(productPrices)) {
      assert.equal(Object.isFrozen(price), true);
    }
  }
}

test('valid state round-trips through the injected durable adapter', async () => {
  let durable: unknown = null;
  const storage: PricingSnapshotStorage = {
    load: async () => clone(durable),
    saveStrict: async (state) => {
      durable = clone(state);
    },
  };
  const expected = activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'prepare-1',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 87.5,
    capturedAtMs: 1_000,
  });

  await createCustomerPricingSnapshotRepository(storage).replace(expected);
  const reader = createCustomerPricingSnapshotRepository(storage);
  const hydrated = await reader.hydrate();

  assert.deepEqual(hydrated, expected);
  assert.strictEqual(reader.getState(), hydrated);
  assertDeeplyFrozen(hydrated);
});

test('corrupt, version-mismatched, and unreadable input hydrates as immutable empty state', async () => {
  const malformedInputs: unknown[] = [
    { version: 2, activeManifest: null, snapshots: {}, requestedMappings: {}, lastKnownPrices: {} },
    { ...clone(emptyPricingSnapshotState()), snapshots: [] },
    {
      ...clone(emptyPricingSnapshotState()),
      lastKnownPrices: {
        '3:11:17': {
          101: {
            productId: 101,
            unitPrice: Number.NaN,
            capturedAtMs: 1_000,
            preparationRunId: 'bad-price',
          },
        },
      },
    },
  ];

  for (const raw of malformedInputs) {
    const repository = createCustomerPricingSnapshotRepository({
      load: async () => raw,
      saveStrict: async () => {
        throw new Error('hydrate must not write');
      },
    });

    const hydrated = await repository.hydrate();
    assert.deepEqual(hydrated, emptyPricingSnapshotState());
    assert.strictEqual(repository.getState(), hydrated);
    assertDeeplyFrozen(hydrated);
  }

  const unreadable = createCustomerPricingSnapshotRepository({
    load: async () => {
      throw new Error('disk unavailable');
    },
    saveStrict: async () => {},
  });
  assert.deepEqual(await unreadable.hydrate(), emptyPricingSnapshotState());
});

test('concurrent updates are serialized and each updater sees the latest published state', async () => {
  const firstSaveStarted = deferred();
  const releaseFirstSave = deferred();
  const savedStates: PricingSnapshotStateV1[] = [];
  let saveCount = 0;
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => null,
    saveStrict: async (state) => {
      saveCount += 1;
      if (saveCount === 1) {
        firstSaveStarted.resolve();
        await releaseFirstSave.promise;
      }
      savedStates.push(clone(state));
    },
  });
  const updaterObservedMappingCounts: number[] = [];

  const first = repository.update((current) => {
    updaterObservedMappingCounts.push(Object.keys(current.requestedMappings).length);
    return recordPrice(current, {
      runId: 'foreground-1',
      partnerId: 11,
      requestedPricelistId: 7,
      resolvedPricelistId: 17,
      productId: 101,
      unitPrice: 81,
      capturedAtMs: 1_000,
    });
  });
  await firstSaveStarted.promise;

  const second = repository.update((current) => {
    updaterObservedMappingCounts.push(Object.keys(current.requestedMappings).length);
    return recordPrice(current, {
      runId: 'foreground-2',
      partnerId: 12,
      requestedPricelistId: 8,
      resolvedPricelistId: 18,
      productId: 102,
      unitPrice: 82,
      capturedAtMs: 2_000,
    });
  });
  await Promise.resolve();
  assert.deepEqual(updaterObservedMappingCounts, [0]);

  releaseFirstSave.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(updaterObservedMappingCounts, [0, 1]);
  assert.equal(savedStates.length, 2);
  assert.equal(Object.keys(savedStates[0].requestedMappings).length, 1);
  assert.equal(Object.keys(savedStates[1].requestedMappings).length, 2);
  assert.equal(
    Object.keys(repository.getState().requestedMappings).length,
    2,
  );
});

test('failed strict save does not publish the candidate in memory', async () => {
  let durable: PricingSnapshotStateV1 | null = null;
  let failSave = false;
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => durable,
    saveStrict: async (state) => {
      if (failSave) {
        throw new Error('strict disk failure');
      }
      durable = clone(state);
    },
  });
  const initial = activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'prepare-before-failure',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 87,
    capturedAtMs: 1_000,
  });
  await repository.replace(initial);
  const publishedBeforeFailure = repository.getState();
  const candidate = recordPrice(initial, {
    runId: 'refresh-that-fails',
    partnerId: 12,
    requestedPricelistId: 8,
    resolvedPricelistId: 18,
    productId: 102,
    unitPrice: 88,
    capturedAtMs: 2_000,
  });

  failSave = true;
  await assert.rejects(
    repository.replace(candidate),
    /strict disk failure/,
  );

  assert.strictEqual(repository.getState(), publishedBeforeFailure);
  assert.deepEqual(durable, publishedBeforeFailure);
});

test('published and returned state is hardened against caller mutation', async () => {
  let durable: PricingSnapshotStateV1 | null = null;
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => durable,
    saveStrict: async (state) => {
      durable = clone(state);
    },
  });
  const mutableCandidate = clone(activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'prepare-immutable',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 89,
    capturedAtMs: 1_000,
  }));

  await repository.replace(mutableCandidate);
  const published = repository.getState();
  const snapshotId = published.activeManifest!.targets[0].snapshotId!;
  (mutableCandidate as any).snapshots[snapshotId].prices[0][1] = 999;

  assert.equal(published.snapshots[snapshotId].prices[0][1], 89);
  assertDeeplyFrozen(published);

  const returned = await repository.update((current) => recordPrice(current, {
    runId: 'refresh-immutable',
    partnerId: 12,
    requestedPricelistId: 8,
    resolvedPricelistId: 18,
    productId: 102,
    unitPrice: 90,
    capturedAtMs: 2_000,
  }));
  assert.strictEqual(repository.getState(), returned);
  assertDeeplyFrozen(returned);
});

test('publication compacts unreferenced snapshots but preserves active state and fallback facts', async () => {
  let persisted: PricingSnapshotStateV1 | null = null;
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => null,
    saveStrict: async (state) => {
      persisted = clone(state);
    },
  });
  const previous = activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'prepare-old',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 81,
    capturedAtMs: 1_000,
  });
  const transitioned = activateSingleTarget(previous, {
    runId: 'prepare-new',
    partnerId: 12,
    requestedPricelistId: 8,
    resolvedPricelistId: 18,
    productId: 102,
    unitPrice: 82,
    capturedAtMs: 2_000,
  });
  assert.equal(Object.keys(transitioned.snapshots).length, 2);

  await repository.replace(transitioned);

  const published = repository.getState();
  const activeSnapshotId = published.activeManifest!.targets[0].snapshotId!;
  assert.deepEqual(Object.keys(published.snapshots), [activeSnapshotId]);
  assert.deepEqual(Object.keys(persisted!.snapshots), [activeSnapshotId]);
  assert.equal(Object.keys(persisted!.requestedMappings).length, 2);
  assert.equal(Object.keys(persisted!.lastKnownPrices).length, 2);
});

test('boot hydrates durable pricing snapshots before catalog and legacy price caches', () => {
  const source = readFileSync(
    new URL('../src/services/rehydrate.ts', import.meta.url),
    'utf8',
  );
  const snapshotHydration = source.indexOf(
    'await hydrateCustomerPricingSnapshots()',
  );
  const catalogHydration = source.indexOf('hydrateFromCache(');
  const legacyPriceHydration = source.indexOf('hydratePriceCacheFromDisk(');

  assert.notEqual(snapshotHydration, -1);
  assert(snapshotHydration < catalogHydration);
  assert(snapshotHydration < legacyPriceHydration);
});

test('the durable repository uses its dedicated versioned storage key', () => {
  const storageSource = readFileSync(
    new URL('../src/persistence/storage.ts', import.meta.url),
    'utf8',
  );
  const repositorySource = readFileSync(
    new URL('../src/services/customerPricingSnapshotRepository.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    storageSource,
    /CUSTOMER_PRICING_SNAPSHOTS:\s*'cache:customerPricingSnapshots:v1',/,
  );
  assert.match(
    repositorySource,
    /STORAGE_KEYS\.CUSTOMER_PRICING_SNAPSHOTS/,
  );
  assert.doesNotMatch(repositorySource, /STORAGE_KEYS\.PRICES_CACHE/);
});
