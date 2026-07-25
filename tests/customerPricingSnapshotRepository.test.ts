import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  activatePreparedPricingRun,
  emptyPricingSnapshotState,
  recordLastKnownServerPrices,
  replacePreparedPricingRun,
  resolveCapturedCustomerPrice,
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

async function hydrateRawState(raw: unknown): Promise<PricingSnapshotStateV1> {
  return createCustomerPricingSnapshotRepository({
    load: async () => raw,
    saveStrict: async () => {
      throw new Error('hydrate must not write');
    },
  }).hydrate();
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

test('a corrupt orphan snapshot does not erase valid active pricing', async () => {
  const active = activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'prepare-active',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 81,
    capturedAtMs: 1_000,
  });
  const activeSnapshotId = active.activeManifest!.targets[0].snapshotId!;
  const raw = clone(active) as any;
  raw.snapshots['corrupt-orphan'] = {
    ...clone(raw.snapshots[activeSnapshotId]),
    snapshotId: 'corrupt-orphan',
    preparationRunId: 'orphan-run',
    productFingerprint: '999',
    prices: [[999, -1]],
  };

  const hydrated = await hydrateRawState(raw);
  const resolved = resolveCapturedCustomerPrice(hydrated, {
    companyId: 3,
    planId: 71,
    partnerId: 11,
    requestedPricelistId: 7,
    productId: 101,
    publicPrice: 100,
  });

  assert.deepEqual(Object.keys(hydrated.snapshots), [activeSnapshotId]);
  assert.equal(resolved.source, 'prepared_customer');
  assert.equal(resolved.unitPrice, 81);
  assertDeeplyFrozen(hydrated);
});

test('corrupt ledger products and mappings are dropped without erasing valid peers', async () => {
  let state = recordPrice(emptyPricingSnapshotState(), {
    runId: 'ledger-1',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 81,
    capturedAtMs: 1_000,
  });
  state = recordPrice(state, {
    runId: 'ledger-2',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 102,
    unitPrice: 82,
    capturedAtMs: 2_000,
  });
  state = recordPrice(state, {
    runId: 'ledger-3',
    partnerId: 11,
    requestedPricelistId: 8,
    resolvedPricelistId: 18,
    productId: 201,
    unitPrice: 83,
    capturedAtMs: 3_000,
  });
  const raw = clone(state) as any;
  raw.lastKnownPrices['3:11:17']['101'].unitPrice = -1;
  raw.requestedMappings['wrong-key'] = clone(
    raw.requestedMappings['3:11:7'],
  );

  const hydrated = await hydrateRawState(raw);

  assert.equal(hydrated.lastKnownPrices['3:11:17']['101'], undefined);
  assert.equal(hydrated.lastKnownPrices['3:11:17']['102'].unitPrice, 82);
  assert.equal(hydrated.lastKnownPrices['3:11:18']['201'].unitPrice, 83);
  assert.deepEqual(
    Object.keys(hydrated.requestedMappings).sort(),
    ['3:11:7', '3:11:8'],
  );
  assert.equal(resolveCapturedCustomerPrice(hydrated, {
    companyId: 3,
    planId: 71,
    partnerId: 11,
    requestedPricelistId: 7,
    productId: 102,
    publicPrice: 100,
  }).source, 'last_known_customer');
  assert.equal(resolveCapturedCustomerPrice(hydrated, {
    companyId: 3,
    planId: 71,
    partnerId: 11,
    requestedPricelistId: 8,
    productId: 201,
    publicPrice: 100,
  }).source, 'last_known_customer');
});

test('a corrupt active snapshot downgrades only its target while valid targets remain prepared', async () => {
  const active = activatePreparedPricingRun(emptyPricingSnapshotState(), {
    companyId: 3,
    planId: 71,
    preparationRunId: 'prepare-two-targets',
    activatedAtMs: 2_000,
    targets: [
      {
        status: 'prepared',
        partnerId: 11,
        requestedPricelistId: 7,
        snapshot: {
          preparedAtMs: 1_000,
          validation: {
            ok: true,
            resolvedPricelistId: 17,
            productFingerprint: '101',
            prices: [[101, 81]],
          },
        },
      },
      {
        status: 'prepared',
        partnerId: 12,
        requestedPricelistId: 8,
        snapshot: {
          preparedAtMs: 1_500,
          validation: {
            ok: true,
            resolvedPricelistId: 18,
            productFingerprint: '102',
            prices: [[102, 82]],
          },
        },
      },
    ],
  });
  const raw = clone(active) as any;
  const corruptTarget = raw.activeManifest.targets[0];
  const validTarget = raw.activeManifest.targets[1];
  raw.snapshots[corruptTarget.snapshotId].partnerId = 999;

  const hydrated = await hydrateRawState(raw);

  assert.deepEqual(hydrated.activeManifest!.targets[0], {
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: null,
    snapshotId: null,
    status: 'failed',
  });
  assert.equal(hydrated.activeManifest!.targets[1].status, 'prepared');
  assert.deepEqual(Object.keys(hydrated.snapshots), [validTarget.snapshotId]);
  assert.equal(resolveCapturedCustomerPrice(hydrated, {
    companyId: 3,
    planId: 71,
    partnerId: 11,
    requestedPricelistId: 7,
    productId: 101,
    publicPrice: 100,
  }).source, 'last_known_customer');
  assert.equal(resolveCapturedCustomerPrice(hydrated, {
    companyId: 3,
    planId: 71,
    partnerId: 12,
    requestedPricelistId: 8,
    productId: 102,
    publicPrice: 100,
  }).source, 'prepared_customer');
});

test('malformed manifest metadata is removed without erasing mappings or ledger', async () => {
  const active = activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'prepare-bad-manifest',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 81,
    capturedAtMs: 1_000,
  });
  const raw = clone(active) as any;
  raw.activeManifest.companyId = 'invalid';

  const hydrated = await hydrateRawState(raw);

  assert.equal(hydrated.activeManifest, null);
  assert.deepEqual(hydrated.snapshots, {});
  assert.equal(Object.keys(hydrated.requestedMappings).length, 1);
  assert.equal(hydrated.lastKnownPrices['3:11:17']['101'].unitPrice, 81);
});

test('fingerprint mismatch, duplicate IDs, and out-of-order tuples cannot publish prepared pricing', async () => {
  const base = activatePreparedPricingRun(emptyPricingSnapshotState(), {
    companyId: 3,
    planId: 71,
    preparationRunId: 'prepare-canonical',
    activatedAtMs: 2_000,
    targets: [{
      status: 'prepared',
      partnerId: 11,
      requestedPricelistId: 7,
      snapshot: {
        preparedAtMs: 1_000,
        validation: {
          ok: true,
          resolvedPricelistId: 17,
          productFingerprint: '101,102',
          prices: [[101, 81], [102, 82]],
        },
      },
    }],
  });
  const corruptions: Array<{
    name: string;
    mutate: (snapshot: any) => void;
  }> = [
    {
      name: 'fingerprint mismatch',
      mutate: (snapshot) => {
        snapshot.productFingerprint = '101,999';
      },
    },
    {
      name: 'duplicate product IDs',
      mutate: (snapshot) => {
        snapshot.productFingerprint = '101,101';
        snapshot.prices = [[101, 81], [101, 82]];
      },
    },
    {
      name: 'out-of-order product IDs',
      mutate: (snapshot) => {
        snapshot.productFingerprint = '102,101';
        snapshot.prices = [[102, 82], [101, 81]];
      },
    },
  ];

  for (const corruption of corruptions) {
    const raw = clone(base) as any;
    const snapshotId = raw.activeManifest.targets[0].snapshotId;
    corruption.mutate(raw.snapshots[snapshotId]);

    const hydrated = await hydrateRawState(raw);
    const resolved = resolveCapturedCustomerPrice(hydrated, {
      companyId: 3,
      planId: 71,
      partnerId: 11,
      requestedPricelistId: 7,
      productId: 101,
      publicPrice: 100,
    });

    assert.deepEqual(hydrated.snapshots, {}, corruption.name);
    assert.equal(
      hydrated.activeManifest!.targets[0].status,
      'failed',
      corruption.name,
    );
    assert.notEqual(resolved.source, 'prepared_customer', corruption.name);
  }
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

test('an incomplete runtime update rejects before save and preserves published state', async () => {
  const savedStates: PricingSnapshotStateV1[] = [];
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => null,
    saveStrict: async (state) => {
      savedStates.push(clone(state));
    },
  });
  const initial = activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'strict-initial',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 81,
    capturedAtMs: 1_000,
  });
  await repository.replace(initial);
  const publishedBeforeInvalidUpdate = repository.getState();

  await assert.rejects(
    repository.update(() => ({ version: 1 } as PricingSnapshotStateV1)),
    /Invalid customer pricing snapshot state/,
  );

  assert.equal(savedStates.length, 1);
  assert.strictEqual(repository.getState(), publishedBeforeInvalidUpdate);
});

test('strict runtime writes reject malformed nested state and prepared cross-references', async () => {
  const valid = activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'strict-nested',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 81,
    capturedAtMs: 1_000,
  });
  const corruptions: Array<{
    name: string;
    mutate: (candidate: any) => void;
  }> = [
    {
      name: 'snapshot fingerprint',
      mutate: (candidate) => {
        const snapshotId = candidate.activeManifest.targets[0].snapshotId;
        candidate.snapshots[snapshotId].productFingerprint = '999';
      },
    },
    {
      name: 'mapping key',
      mutate: (candidate) => {
        candidate.requestedMappings['wrong-key'] = clone(
          candidate.requestedMappings['3:11:7'],
        );
      },
    },
    {
      name: 'ledger product',
      mutate: (candidate) => {
        candidate.lastKnownPrices['3:11:17']['101'].unitPrice = -1;
      },
    },
    {
      name: 'manifest metadata',
      mutate: (candidate) => {
        candidate.activeManifest.activatedAtMs = -1;
      },
    },
    {
      name: 'manifest target',
      mutate: (candidate) => {
        candidate.activeManifest.targets.push({
          partnerId: -1,
          requestedPricelistId: 8,
          resolvedPricelistId: 18,
          snapshotId: 'invalid-target',
          status: 'prepared',
        });
      },
    },
    {
      name: 'prepared target cross-reference',
      mutate: (candidate) => {
        candidate.activeManifest.targets[0].snapshotId = 'missing-snapshot';
      },
    },
  ];

  for (const corruption of corruptions) {
    let saveCalls = 0;
    const repository = createCustomerPricingSnapshotRepository({
      load: async () => null,
      saveStrict: async () => {
        saveCalls += 1;
      },
    });
    await repository.replace(valid);
    const publishedBeforeInvalidReplace = repository.getState();
    const malformed = clone(valid) as any;
    corruption.mutate(malformed);

    await assert.rejects(
      repository.replace(malformed),
      /Invalid customer pricing snapshot state/,
      corruption.name,
    );
    assert.equal(saveCalls, 1, corruption.name);
    assert.strictEqual(
      repository.getState(),
      publishedBeforeInvalidReplace,
      corruption.name,
    );
  }
});

test('a valid queued update succeeds after strict validation rejects its predecessor', async () => {
  const savedStates: PricingSnapshotStateV1[] = [];
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => null,
    saveStrict: async (state) => {
      savedStates.push(clone(state));
    },
  });
  const initial = activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'strict-queue-initial',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 81,
    capturedAtMs: 1_000,
  });
  await repository.replace(initial);

  const rejected = repository.update(
    () => ({ version: 1 } as PricingSnapshotStateV1),
  );
  const accepted = repository.update((current) => recordPrice(current, {
    runId: 'strict-queue-recovery',
    partnerId: 12,
    requestedPricelistId: 8,
    resolvedPricelistId: 18,
    productId: 102,
    unitPrice: 82,
    capturedAtMs: 2_000,
  }));

  await assert.rejects(
    rejected,
    /Invalid customer pricing snapshot state/,
  );
  const published = await accepted;

  assert.equal(savedStates.length, 2);
  assert.deepEqual(
    Object.keys(published.requestedMappings).sort(),
    ['3:11:7', '3:12:8'],
  );
  assert.strictEqual(repository.getState(), published);
});

test('the serialized queue continues from published state after a rejected save', async () => {
  let rejectNextSave = true;
  let saveCalls = 0;
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => null,
    saveStrict: async () => {
      saveCalls += 1;
      if (rejectNextSave) {
        throw new Error('first write rejected');
      }
    },
  });

  await assert.rejects(repository.update((current) => recordPrice(current, {
    runId: 'rejected-update',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 81,
    capturedAtMs: 1_000,
  })), /first write rejected/);

  rejectNextSave = false;
  const recovered = await repository.update((current) => {
    assert.equal(Object.keys(current.requestedMappings).length, 0);
    return recordPrice(current, {
      runId: 'accepted-update',
      partnerId: 12,
      requestedPricelistId: 8,
      resolvedPricelistId: 18,
      productId: 102,
      unitPrice: 82,
      capturedAtMs: 2_000,
    });
  });

  assert.equal(saveCalls, 2);
  assert.deepEqual(Object.keys(recovered.requestedMappings), ['3:12:8']);
  assert.strictEqual(repository.getState(), recovered);
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

test('strict writes and tolerant hydration share mixed-run pointer identity rules', async () => {
  const initial = activatePreparedPricingRun(emptyPricingSnapshotState(), {
    companyId: 3,
    planId: 71,
    preparationRunId: 'prepare-initial',
    activatedAtMs: 1_100,
    targets: [
      {
        status: 'prepared',
        partnerId: 11,
        requestedPricelistId: 7,
        snapshot: {
          preparedAtMs: 1_000,
          validation: {
            ok: true,
            resolvedPricelistId: 17,
            productFingerprint: '101',
            prices: [[101, 81]],
          },
        },
      },
      {
        status: 'failed',
        partnerId: 12,
        requestedPricelistId: 8,
      },
    ],
  });
  const replacement = replacePreparedPricingRun(initial, {
    companyId: 3,
    planId: 71,
    preparationRunId: 'prepare-retry',
    activatedAtMs: 2_100,
    targets: [{
      status: 'prepared',
      partnerId: 12,
      requestedPricelistId: 8,
      snapshot: {
        preparedAtMs: 2_000,
        validation: {
          ok: true,
          resolvedPricelistId: 18,
          productFingerprint: '102',
          prices: [[102, 82]],
        },
      },
    }],
  });
  let durable: unknown = null;
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => clone(durable),
    saveStrict: async (state) => {
      durable = clone(state);
    },
  });

  await repository.replace(replacement);
  assert.deepEqual(
    Object.keys(repository.getState().snapshots).sort(),
    ['prepare-initial:3:11:17', 'prepare-retry:3:12:18'],
  );
  assert.equal(resolveCapturedCustomerPrice(repository.getState(), {
    companyId: 3,
    planId: 71,
    partnerId: 11,
    requestedPricelistId: 7,
    productId: 101,
    publicPrice: 100,
  }).source, 'prepared_customer');
  assert.equal(resolveCapturedCustomerPrice(repository.getState(), {
    companyId: 3,
    planId: 71,
    partnerId: 12,
    requestedPricelistId: 8,
    productId: 102,
    publicPrice: 100,
  }).source, 'prepared_customer');

  const corrupt = clone(replacement) as any;
  const oldTarget = corrupt.activeManifest.targets[0];
  const oldSnapshot = corrupt.snapshots[oldTarget.snapshotId];
  const forgedSnapshotId = 'forged-run:3:11:17';
  corrupt.snapshots[forgedSnapshotId] = {
    ...oldSnapshot,
    snapshotId: forgedSnapshotId,
  };
  oldTarget.snapshotId = forgedSnapshotId;

  await assert.rejects(repository.replace(corrupt), /Invalid customer pricing/);

  const hydrated = await hydrateRawState(corrupt);
  assert.equal(hydrated.activeManifest!.targets[0].status, 'failed');
  assert.equal(hydrated.activeManifest!.targets[1].status, 'prepared');
  assert.deepEqual(
    Object.keys(hydrated.snapshots),
    ['prepare-retry:3:12:18'],
  );
});

test('a strict foreground remap preserves the structurally valid active manifest', async () => {
  const initial = activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'prepare-before-remap',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 81,
    capturedAtMs: 1_000,
  });
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => null,
    saveStrict: async () => {},
  });
  await repository.replace(initial);

  const remapped = await repository.update((current) => recordPrice(current, {
    runId: 'foreground-remap',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 18,
    productId: 101,
    unitPrice: 82,
    capturedAtMs: 2_000,
  }));

  assert.deepEqual(remapped.activeManifest, initial.activeManifest);
  assert.deepEqual(
    Object.keys(remapped.snapshots),
    ['prepare-before-remap:3:11:17'],
  );
  assert.equal(remapped.requestedMappings['3:11:7'].resolvedPricelistId, 18);
  assert.deepEqual(resolveCapturedCustomerPrice(remapped, {
    companyId: 3,
    planId: 71,
    partnerId: 11,
    requestedPricelistId: 7,
    productId: 101,
    publicPrice: 100,
  }), {
    unitPrice: 82,
    source: 'last_known_customer',
    capturedAtMs: 2_000,
    pricelistId: 18,
  });
});

test('tolerant hydration keeps a structurally valid manifest after a mapping remap', async () => {
  const initial = activateSingleTarget(emptyPricingSnapshotState(), {
    runId: 'prepare-before-hydrated-remap',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 17,
    productId: 101,
    unitPrice: 81,
    capturedAtMs: 1_000,
  });
  const remapped = recordPrice(initial, {
    runId: 'foreground-hydrated-remap',
    partnerId: 11,
    requestedPricelistId: 7,
    resolvedPricelistId: 18,
    productId: 101,
    unitPrice: 82,
    capturedAtMs: 2_000,
  });

  const hydrated = await hydrateRawState(remapped);

  assert.deepEqual(hydrated.activeManifest, initial.activeManifest);
  assert.deepEqual(
    Object.keys(hydrated.snapshots),
    ['prepare-before-hydrated-remap:3:11:17'],
  );
  assert.deepEqual(resolveCapturedCustomerPrice(hydrated, {
    companyId: 3,
    planId: 71,
    partnerId: 11,
    requestedPricelistId: 7,
    productId: 101,
    publicPrice: 100,
  }), {
    unitPrice: 82,
    source: 'last_known_customer',
    capturedAtMs: 2_000,
    pricelistId: 18,
  });
});

test('boot hydrates durable pricing snapshots before catalog and legacy price caches', () => {
  const source = readFileSync(
    new URL('../src/services/rehydrate.ts', import.meta.url),
    'utf8',
  );
  const snapshotHydration = source.indexOf(
    'await hydrateCustomerPricingSnapshots()',
  );
  const catalogHydration = source.indexOf('hydrateOfflineCatalog(warehouseId)');
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
