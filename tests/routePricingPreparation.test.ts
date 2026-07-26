import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activatePreparedPricingRun,
  emptyPricingSnapshotState,
  recordLastKnownServerPrices,
  replacePreparedPricingRun,
  type ValidatedServerPriceSnapshot,
} from '../src/services/customerPricingSnapshot.ts';
import {
  createCustomerPricingSnapshotRepository,
} from '../src/services/customerPricingSnapshotRepository.ts';
import {
  prepareRoutePricingTargets,
  settleRoutePricingTargets,
} from '../src/services/routePreparationLogic.ts';
import type {
  RoutePricingTarget,
} from '../src/services/routePricingTargets.ts';

function validSnapshot(
  resolvedPricelistId: number,
  unitPrice = resolvedPricelistId,
): ValidatedServerPriceSnapshot {
  return {
    ok: true,
    resolvedPricelistId,
    productFingerprint: '10,20',
    prices: [[10, unitPrice], [20, unitPrice + 1]],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test('settles route pricing targets with bounded concurrency and deterministic order', async () => {
  const targets: RoutePricingTarget[] = Array.from({ length: 6 }, (_, index) => ({
    partnerId: index + 1,
    requestedPricelistId: 80 + index,
  }));
  const gates = targets.map(() => deferred<ValidatedServerPriceSnapshot>());
  const started: number[] = [];
  let nextTimestamp = 1_000;
  let active = 0;
  let maxActive = 0;

  const settling = settleRoutePricingTargets({
    targets,
    companyId: 34,
    planId: 7,
    preparationRunId: 'prepare-1',
    concurrency: 4,
    nowMs: () => nextTimestamp++,
    fetchTarget: async (target) => {
      const index = target.partnerId - 1;
      started.push(index);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await gates[index]!.promise;
      } finally {
        active -= 1;
      }
    },
  });

  await nextTurn();
  assert.deepEqual(started, [0, 1, 2, 3]);
  assert.equal(maxActive, 4);

  gates[1]!.resolve(validSnapshot(81));
  await nextTurn();
  assert.deepEqual(started, [0, 1, 2, 3, 4]);

  gates[0]!.resolve(validSnapshot(80));
  await nextTurn();
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);

  for (let index = 2; index < gates.length; index += 1) {
    gates[index]!.resolve(validSnapshot(80 + index));
  }

  const result = await settling;

  assert.equal(maxActive, 4);
  assert.deepEqual(
    result.activationInput.targets.map((target) => ({
      partnerId: target.partnerId,
      requestedPricelistId: target.requestedPricelistId,
      status: target.status,
    })),
    targets.map((target) => ({ ...target, status: 'prepared' })),
  );
  assert.equal(result.preparedCount, 6);
  assert.equal(result.pricesPrepared, 12);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(
    result.activationInput.targets.map((target) =>
      target.status === 'prepared' ? target.snapshot.preparedAtMs : null
    ),
    [1_000, 1_001, 1_002, 1_003, 1_004, 1_005],
  );
  assert.equal(result.activationInput.activatedAtMs, 1_006);
});

test('turns thrown and invalid target results into exact failed manifest targets', async () => {
  const targets: RoutePricingTarget[] = [
    { partnerId: 99, requestedPricelistId: 81 },
    { partnerId: 99, requestedPricelistId: 90 },
    { partnerId: 100, requestedPricelistId: null },
    { partnerId: 101, requestedPricelistId: 91 },
  ];

  const result = await settleRoutePricingTargets({
    targets,
    companyId: 34,
    planId: 7,
    preparationRunId: 'prepare-errors',
    concurrency: 4,
    expectedProductFingerprint: '10,20',
    nowMs: () => 2_000,
    fetchTarget: async (target) => {
      if (target.requestedPricelistId === 90) {
        throw new Error('Odoo no disponible');
      }
      if (target.requestedPricelistId === null) {
        return {
          ok: true,
          resolvedPricelistId: 81,
          productFingerprint: '10',
          prices: [[10, 42]],
        };
      }
      return validSnapshot(target.requestedPricelistId);
    },
  });

  assert.deepEqual(
    result.activationInput.targets.map((target) => ({
      partnerId: target.partnerId,
      requestedPricelistId: target.requestedPricelistId,
      status: target.status,
    })),
    [
      { partnerId: 99, requestedPricelistId: 81, status: 'prepared' },
      { partnerId: 99, requestedPricelistId: 90, status: 'failed' },
      { partnerId: 100, requestedPricelistId: null, status: 'failed' },
      { partnerId: 101, requestedPricelistId: 91, status: 'prepared' },
    ],
  );
  assert.deepEqual(result.failures, [
    {
      partnerId: 99,
      requestedPricelistId: 90,
      reason: 'Odoo no disponible',
    },
    {
      partnerId: 100,
      requestedPricelistId: null,
      reason: 'Respuesta de precios incompleta o inválida',
    },
  ]);
  assert.equal(result.preparedCount, 2);
  assert.equal(result.pricesPrepared, 4);
});

test('publishes once after every fetch settles and merges with latest repository state', async () => {
  const fetchStarted = deferred<void>();
  const releaseFetch = deferred<void>();
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => null,
    saveStrict: async () => {},
  });
  let routeUpdaterCalls = 0;

  const preparing = prepareRoutePricingTargets({
    targets: [{ partnerId: 99, requestedPricelistId: 81 }],
    companyId: 34,
    planId: 7,
    preparationRunId: 'prepare-race',
    concurrency: 4,
    nowMs: () => 3_000,
    fetchTarget: async () => {
      fetchStarted.resolve();
      await releaseFetch.promise;
      return validSnapshot(81);
    },
    updateState: async (updater) => {
      routeUpdaterCalls += 1;
      return repository.update(updater);
    },
  });

  await fetchStarted.promise;
  await repository.update((current) => recordLastKnownServerPrices(current, {
    companyId: 34,
    partnerId: 500,
    requestedPricelistId: 95,
    capturedAtMs: 2_500,
    captureRunId: 'foreground',
    validation: validSnapshot(95, 12),
  }));
  assert.equal(routeUpdaterCalls, 0);

  releaseFetch.resolve();
  await preparing;

  const finalState = repository.getState();
  assert.equal(routeUpdaterCalls, 1);
  assert.equal(finalState.activeManifest?.preparationRunId, 'prepare-race');
  assert.equal(
    finalState.lastKnownPrices['34:500:95']?.['10']?.preparationRunId,
    'foreground',
  );
  assert.deepEqual(
    finalState.snapshots['prepare-race:34:99:81']?.prices,
    [[10, 81], [20, 82]],
  );
});

test('a response cannot overwrite foreground pricing published after its request started', async () => {
  for (const foregroundCapturedAtMs of [1_000, 2_000]) {
    const fetchStarted = deferred<void>();
    const releaseFetch = deferred<void>();
    let current = emptyPricingSnapshotState();
    let wallClockMs = 1_000;

    const preparing = prepareRoutePricingTargets({
      targets: [{ partnerId: 99, requestedPricelistId: 81 }],
      companyId: 34,
      planId: 7,
      preparationRunId: `request-clock-${foregroundCapturedAtMs}`,
      concurrency: 1,
      nowMs: () => wallClockMs,
      fetchTarget: async () => {
        fetchStarted.resolve();
        await releaseFetch.promise;
        return validSnapshot(81, 22);
      },
      updateState: async (updater) => {
        current = updater(current);
        return current;
      },
    });

    await fetchStarted.promise;
    current = recordLastKnownServerPrices(current, {
      companyId: 34,
      partnerId: 99,
      requestedPricelistId: 81,
      capturedAtMs: foregroundCapturedAtMs,
      captureRunId: `foreground-${foregroundCapturedAtMs}`,
      validation: validSnapshot(81, 44),
    });
    wallClockMs = 3_000;
    releaseFetch.resolve();

    const result = await preparing;
    assert.equal(current.activeManifest?.targets[0]?.status, 'failed');
    assert.equal(result.preparedCount, 0);
    assert.equal(result.pricesPrepared, 0);
    assert.deepEqual(result.failures, [{
      partnerId: 99,
      requestedPricelistId: 81,
      reason: 'Se conservaron precios más recientes para esta combinación',
    }]);
    assert.equal(
      current.lastKnownPrices['34:99:81']?.['10']?.unitPrice,
      44,
    );
  }
});

test('reports a stale prepared target as failed after activation preserves newer pricing', async () => {
  const timestamps = [1_000, 2_500, 3_000];
  let current = emptyPricingSnapshotState();

  const result = await prepareRoutePricingTargets({
    targets: [
      { partnerId: 99, requestedPricelistId: 104 },
      { partnerId: 100, requestedPricelistId: 104 },
    ],
    companyId: 34,
    planId: 7,
    preparationRunId: 'prepare-interleaved',
    concurrency: 1,
    nowMs: () => timestamps.shift()!,
    fetchTarget: async (target) => target.partnerId === 99
      ? validSnapshot(81, 22)
      : validSnapshot(83, 55),
    updateState: async (updater) => {
      current = recordLastKnownServerPrices(current, {
        companyId: 34,
        partnerId: 99,
        requestedPricelistId: 105,
        capturedAtMs: 2_000,
        captureRunId: 'foreground-alias',
        validation: validSnapshot(81, 44),
      });
      current = updater(current);
      return current;
    },
  });

  assert.deepEqual(current.activeManifest?.targets.map((target) => ({
    partnerId: target.partnerId,
    status: target.status,
  })), [
    { partnerId: 99, status: 'failed' },
    { partnerId: 100, status: 'prepared' },
  ]);
  assert.equal(result.preparedCount, 1);
  assert.equal(result.pricesPrepared, 2);
  assert.deepEqual(result.failures, [{
    partnerId: 99,
    requestedPricelistId: 104,
    reason: 'Se conservaron precios más recientes para esta combinación',
  }]);
});

test('a strict save failure leaves no partially published preparation state', async () => {
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => null,
    saveStrict: async () => {
      throw new Error('disk full');
    },
  });
  const before = repository.getState();
  let routeUpdaterCalls = 0;

  await assert.rejects(
    prepareRoutePricingTargets({
      targets: [
        { partnerId: 99, requestedPricelistId: 81 },
        { partnerId: 99, requestedPricelistId: 90 },
      ],
      companyId: 34,
      planId: 7,
      preparationRunId: 'prepare-save-failure',
      concurrency: 4,
      nowMs: () => 4_000,
      fetchTarget: async (target) =>
        validSnapshot(target.requestedPricelistId!),
      updateState: async (updater) => {
        routeUpdaterCalls += 1;
        return repository.update(updater);
      },
    }),
    /disk full/,
  );

  assert.equal(routeUpdaterCalls, 1);
  assert.strictEqual(repository.getState(), before);
  assert.equal(repository.getState().activeManifest, null);
  assert.deepEqual(repository.getState().snapshots, {});
});

test('exact retry fetches only failed pairs and preserves prior prepared snapshot IDs', async () => {
  const initial = activatePreparedPricingRun(emptyPricingSnapshotState(), {
    companyId: 34,
    planId: 7,
    preparationRunId: 'prepare-initial',
    activatedAtMs: 1_100,
    targets: [
      {
        status: 'prepared',
        partnerId: 99,
        requestedPricelistId: 81,
        snapshot: {
          preparedAtMs: 1_000,
          validation: validSnapshot(81, 42),
        },
      },
      {
        status: 'failed',
        partnerId: 99,
        requestedPricelistId: 90,
      },
    ],
  });
  const repository = createCustomerPricingSnapshotRepository({
    load: async () => null,
    saveStrict: async () => {},
  });
  await repository.replace(initial);
  const priorSnapshotId = initial.activeManifest!.targets[0]!.snapshotId;
  const fetched: RoutePricingTarget[] = [];
  let routeUpdaterCalls = 0;

  await prepareRoutePricingTargets({
    targets: [{ partnerId: 99, requestedPricelistId: 90 }],
    companyId: 34,
    planId: 7,
    preparationRunId: 'prepare-retry',
    concurrency: 4,
    nowMs: () => 2_000,
    fetchTarget: async (target) => {
      fetched.push(target);
      return validSnapshot(90, 55);
    },
    activateRun: replacePreparedPricingRun,
    updateState: async (updater) => {
      routeUpdaterCalls += 1;
      return repository.update(updater);
    },
  });

  const finalState = repository.getState();
  assert.deepEqual(fetched, [{ partnerId: 99, requestedPricelistId: 90 }]);
  assert.equal(routeUpdaterCalls, 1);
  assert.equal(finalState.activeManifest?.preparationRunId, 'prepare-retry');
  assert.deepEqual(finalState.activeManifest?.targets, [
    {
      partnerId: 99,
      requestedPricelistId: 81,
      resolvedPricelistId: 81,
      snapshotId: priorSnapshotId,
      status: 'prepared',
    },
    {
      partnerId: 99,
      requestedPricelistId: 90,
      resolvedPricelistId: 90,
      snapshotId: 'prepare-retry:34:99:90',
      status: 'prepared',
    },
  ]);
  assert.deepEqual(
    Object.keys(finalState.snapshots).sort(),
    ['prepare-initial:34:99:81', 'prepare-retry:34:99:90'],
  );
  assert.deepEqual(
    finalState.snapshots['prepare-initial:34:99:81']?.prices,
    [[10, 42], [20, 43]],
  );
});
