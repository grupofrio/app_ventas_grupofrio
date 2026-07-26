import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activatePreparedPricingRun,
  compactPricingSnapshotState,
  emptyPricingSnapshotState,
  recordLastKnownServerPrices,
  replacePreparedPricingRun,
  resolveCapturedCustomerPrice,
  validateServerPriceSnapshot,
  type PricingSnapshotStateV1,
  type ValidatedServerPriceSnapshot,
} from '../src/services/customerPricingSnapshot.ts';

function validServerSnapshot(
  prices: Array<[productId: number, unitPrice: number]>,
  resolvedPricelistId = 81,
): ValidatedServerPriceSnapshot {
  const result = validateServerPriceSnapshot({
    resolvedPricelistId,
    requestedProductIds: prices.map(([productId]) => productId),
    rows: prices.map(([productId, unitPrice]) => ({ productId, unitPrice })),
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error('Expected valid server price snapshot');
  }
  return result;
}

function activateSinglePreparedTarget(
  current: PricingSnapshotStateV1,
  {
    preparationRunId,
    preparedAtMs,
    unitPrice,
  }: {
    preparationRunId: string;
    preparedAtMs: number;
    unitPrice: number;
  },
): PricingSnapshotStateV1 {
  return activatePreparedPricingRun(current, {
    companyId: 34,
    planId: 7,
    preparationRunId,
    activatedAtMs: preparedAtMs + 1,
    targets: [{
      status: 'prepared',
      partnerId: 99,
      requestedPricelistId: 104,
      snapshot: {
        preparedAtMs,
        validation: validServerSnapshot([[10, unitPrice]]),
      },
    }],
  });
}

test('rejects a response without exact requested product coverage', () => {
  const result = validateServerPriceSnapshot({
    resolvedPricelistId: 81,
    requestedProductIds: [10, 20],
    rows: [{ productId: 10, unitPrice: 42 }],
  });

  assert.deepEqual(result, {
    ok: false,
    reason: 'incomplete_product_coverage',
    missingProductIds: [20],
  });
});

test('rejects a non-positive resolved pricelist', () => {
  const result = validateServerPriceSnapshot({
    resolvedPricelistId: 0,
    requestedProductIds: [10],
    rows: [{ productId: 10, unitPrice: 42 }],
  });

  assert.deepEqual(result, {
    ok: false,
    reason: 'invalid_resolved_pricelist',
  });
});

test('rejects negative and non-finite requested-product prices', () => {
  for (const unitPrice of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = validateServerPriceSnapshot({
      resolvedPricelistId: 81,
      requestedProductIds: [10],
      rows: [{ productId: 10, unitPrice }],
    });

    assert.deepEqual(result, {
      ok: false,
      reason: 'invalid_price',
      productId: 10,
    });
  }
});

test('discards extra server rows before validating exact requested coverage', () => {
  const result = validateServerPriceSnapshot({
    resolvedPricelistId: 81,
    requestedProductIds: [20, 10],
    rows: [
      { productId: 99, unitPrice: Number.NEGATIVE_INFINITY },
      { productId: 20, unitPrice: 84 },
      { productId: 10, unitPrice: 0 },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    resolvedPricelistId: 81,
    productFingerprint: '10,20',
    prices: [[10, 0], [20, 84]],
  });
});

test('deduplicates requested product IDs deterministically', () => {
  const result = validateServerPriceSnapshot({
    resolvedPricelistId: 81,
    requestedProductIds: [20, 10, 20, 10],
    rows: [
      { productId: 20, unitPrice: 84 },
      { productId: 10, unitPrice: 42 },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    resolvedPricelistId: 81,
    productFingerprint: '10,20',
    prices: [[10, 42], [20, 84]],
  });
});

test('rejects conflicting response rows for one requested product', () => {
  const result = validateServerPriceSnapshot({
    resolvedPricelistId: 81,
    requestedProductIds: [10],
    rows: [
      { productId: 10, unitPrice: 42 },
      { productId: 10, unitPrice: 43 },
    ],
  });

  assert.deepEqual(result, {
    ok: false,
    reason: 'conflicting_product_rows',
    productId: 10,
  });
});

test('activates a new preparation run without overwriting prior snapshots', () => {
  const previous = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-old',
    preparedAtMs: 1_000,
    unitPrice: 40,
  });
  const previousSnapshot = previous.snapshots['run-old:34:99:81'];

  const next = activateSinglePreparedTarget(previous, {
    preparationRunId: 'run-new',
    preparedAtMs: 2_000,
    unitPrice: 42,
  });

  assert.equal(next.activeManifest?.preparationRunId, 'run-new');
  assert.deepEqual(next.snapshots['run-old:34:99:81'], previousSnapshot);
  assert.notEqual(next.snapshots['run-old:34:99:81'], previousSnapshot);
  assert.deepEqual(next.snapshots['run-new:34:99:81']?.prices, [[10, 42]]);
  assert.equal(previous.activeManifest?.preparationRunId, 'run-old');
  assert.equal(previous.snapshots['run-new:34:99:81'], undefined);
});

test('explicit compaction retains only snapshots referenced by the active repeated run', () => {
  const runOld = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-old',
    preparedAtMs: 1_000,
    unitPrice: 40,
  });
  const runMiddle = activateSinglePreparedTarget(runOld, {
    preparationRunId: 'run-middle',
    preparedAtMs: 2_000,
    unitPrice: 41,
  });
  const runActive = activateSinglePreparedTarget(runMiddle, {
    preparationRunId: 'run-active',
    preparedAtMs: 3_000,
    unitPrice: 42,
  });

  assert.deepEqual(Object.keys(runActive.snapshots).sort(), [
    'run-active:34:99:81',
    'run-middle:34:99:81',
    'run-old:34:99:81',
  ]);

  const compacted = compactPricingSnapshotState(runActive);

  assert.deepEqual(Object.keys(compacted.snapshots), ['run-active:34:99:81']);
  assert.deepEqual(compacted.activeManifest, runActive.activeManifest);
  assert.deepEqual(compacted.requestedMappings, runActive.requestedMappings);
  assert.deepEqual(compacted.lastKnownPrices, runActive.lastKnownPrices);
  assert.equal(Object.isFrozen(compacted), true);
  assert.equal(Object.isFrozen(compacted.snapshots['run-active:34:99:81']), true);
});

test('compaction drops every unreferenced snapshot when there is no active manifest', () => {
  const prepared = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-detached',
    preparedAtMs: 1_000,
    unitPrice: 42,
  });
  const detached: PricingSnapshotStateV1 = {
    ...prepared,
    activeManifest: null,
  };

  const compacted = compactPricingSnapshotState(detached);

  assert.deepEqual(compacted.snapshots, {});
  assert.deepEqual(compacted.requestedMappings, prepared.requestedMappings);
  assert.deepEqual(compacted.lastKnownPrices, prepared.lastKnownPrices);
  assert.equal(Object.isFrozen(compacted.requestedMappings), true);
  assert.equal(Object.isFrozen(compacted.lastKnownPrices['34:99:81']), true);
});

test('published state is deeply immutable without freezing its input state', () => {
  const original = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-frozen',
    preparedAtMs: 1_000,
    unitPrice: 42,
  });
  const mutableInput = JSON.parse(JSON.stringify(original)) as PricingSnapshotStateV1;
  const state = activatePreparedPricingRun(mutableInput, {
    companyId: 34,
    planId: 7,
    preparationRunId: 'run-failed',
    activatedAtMs: 2_000,
    targets: [{
      status: 'failed',
      partnerId: 100,
      requestedPricelistId: 104,
    }],
  });
  const snapshot = state.snapshots['run-frozen:34:99:81']!;
  const target = state.activeManifest!.targets[0]!;
  const mapping = state.requestedMappings['34:99:104']!;
  const ledgerPrice = state.lastKnownPrices['34:99:81']!['10']!;

  assert.equal(Object.isFrozen(mutableInput), false);
  assert.equal(Object.isFrozen(mutableInput.snapshots['run-frozen:34:99:81']), false);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.snapshots), true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.prices), true);
  assert.equal(Object.isFrozen(snapshot.prices[0]), true);
  assert.equal(Object.isFrozen(state.activeManifest), true);
  assert.equal(Object.isFrozen(state.activeManifest?.targets), true);
  assert.equal(Object.isFrozen(target), true);
  assert.equal(Object.isFrozen(mapping), true);
  assert.equal(Object.isFrozen(ledgerPrice), true);

  assert.throws(() => {
    (snapshot.prices as unknown as Array<[number, number]>)[0]![1] = 999;
  }, TypeError);
  assert.throws(() => {
    (target as { status: 'prepared' | 'failed' }).status = 'prepared';
  }, TypeError);
  assert.throws(() => {
    (mapping as { resolvedPricelistId: number }).resolvedPricelistId = 82;
  }, TypeError);
  assert.throws(() => {
    (ledgerPrice as { unitPrice: number }).unitPrice = 999;
  }, TypeError);

  assert.deepEqual(
    resolveCapturedCustomerPrice(state, {
      companyId: 34,
      planId: 7,
      partnerId: 99,
      requestedPricelistId: 104,
      productId: 10,
      publicPrice: 100,
    }),
    {
      unitPrice: 42,
      source: 'last_known_customer',
      capturedAtMs: 1_000,
      pricelistId: 81,
    },
  );
  assert.deepEqual(snapshot.prices, [[10, 42]]);
});

test('a failed target preserves its prior snapshots, mapping, and last-known ledger', () => {
  const previous = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-old',
    preparedAtMs: 1_000,
    unitPrice: 40,
  });

  const next = activatePreparedPricingRun(previous, {
    companyId: 34,
    planId: 7,
    preparationRunId: 'run-new',
    activatedAtMs: 2_000,
    targets: [{
      status: 'failed',
      partnerId: 99,
      requestedPricelistId: 104,
    }],
  });

  assert.deepEqual(next.snapshots, previous.snapshots);
  assert.deepEqual(next.requestedMappings, previous.requestedMappings);
  assert.deepEqual(next.lastKnownPrices, previous.lastKnownPrices);
  assert.deepEqual(next.activeManifest?.targets, [{
    partnerId: 99,
    requestedPricelistId: 104,
    resolvedPricelistId: null,
    snapshotId: null,
    status: 'failed',
  }]);
  assert.equal(
    resolveCapturedCustomerPrice(next, {
      companyId: 34,
      planId: 7,
      partnerId: 99,
      requestedPricelistId: 104,
      productId: 10,
      publicPrice: 100,
    }).source,
    'last_known_customer',
  );
});

test('foreground last-known recording does not activate or replace prepared snapshots', () => {
  const previous = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-prepared',
    preparedAtMs: 1_000,
    unitPrice: 40,
  });
  const validation = validServerSnapshot([[10, 44]], 82);

  const next = recordLastKnownServerPrices(previous, {
    companyId: 34,
    partnerId: 99,
    requestedPricelistId: 105,
    capturedAtMs: 2_000,
    captureRunId: 'foreground-1',
    validation,
  });

  assert.deepEqual(next.activeManifest, previous.activeManifest);
  assert.notEqual(next.activeManifest, previous.activeManifest);
  assert.deepEqual(next.snapshots, previous.snapshots);
  assert.deepEqual(next.lastKnownPrices['34:99:82']?.['10'], {
    productId: 10,
    unitPrice: 44,
    capturedAtMs: 2_000,
    preparationRunId: 'foreground-1',
  });
});

test('older or equal foreground responses cannot roll back a newer requested mapping', () => {
  const newer = recordLastKnownServerPrices(emptyPricingSnapshotState(), {
    companyId: 34,
    partnerId: 99,
    requestedPricelistId: 104,
    capturedAtMs: 2_000,
    captureRunId: 'foreground-newer',
    validation: validServerSnapshot([[10, 44]], 81),
  });
  const older = recordLastKnownServerPrices(newer, {
    companyId: 34,
    partnerId: 99,
    requestedPricelistId: 104,
    capturedAtMs: 1_000,
    captureRunId: 'foreground-older',
    validation: validServerSnapshot([[10, 22]], 82),
  });
  const equal = recordLastKnownServerPrices(older, {
    companyId: 34,
    partnerId: 99,
    requestedPricelistId: 104,
    capturedAtMs: 2_000,
    captureRunId: 'foreground-equal',
    validation: validServerSnapshot([[10, 33]], 83),
  });

  assert.deepEqual(equal.requestedMappings['34:99:104'], {
    companyId: 34,
    partnerId: 99,
    requestedPricelistId: 104,
    resolvedPricelistId: 81,
    preparationRunId: 'foreground-newer',
    capturedAtMs: 2_000,
  });
  assert.deepEqual(
    resolveCapturedCustomerPrice(equal, {
      companyId: 34,
      planId: 7,
      partnerId: 99,
      requestedPricelistId: 104,
      productId: 10,
      publicPrice: 100,
    }),
    {
      unitPrice: 44,
      source: 'last_known_customer',
      capturedAtMs: 2_000,
      pricelistId: 81,
    },
  );
});

test('an older prepared response cannot roll back a newer last-known ledger entry', () => {
  const foreground = recordLastKnownServerPrices(emptyPricingSnapshotState(), {
    companyId: 34,
    partnerId: 99,
    requestedPricelistId: 104,
    capturedAtMs: 2_000,
    captureRunId: 'foreground-newer',
    validation: validServerSnapshot([[10, 44]]),
  });
  const prepared = activateSinglePreparedTarget(foreground, {
    preparationRunId: 'run-older',
    preparedAtMs: 1_000,
    unitPrice: 42,
  });
  const failedNext = activatePreparedPricingRun(prepared, {
    companyId: 34,
    planId: 7,
    preparationRunId: 'run-failed',
    activatedAtMs: 3_000,
    targets: [{
      status: 'failed',
      partnerId: 99,
      requestedPricelistId: 104,
    }],
  });

  assert.deepEqual(prepared.lastKnownPrices['34:99:81']?.['10'], {
    productId: 10,
    unitPrice: 44,
    capturedAtMs: 2_000,
    preparationRunId: 'foreground-newer',
  });
  assert.deepEqual(
    resolveCapturedCustomerPrice(failedNext, {
      companyId: 34,
      planId: 7,
      partnerId: 99,
      requestedPricelistId: 104,
      productId: 10,
      publicPrice: 100,
    }),
    {
      unitPrice: 44,
      source: 'last_known_customer',
      capturedAtMs: 2_000,
      pricelistId: 81,
    },
  );
});

test('a delayed preparation activates only observations newer than foreground pricing', () => {
  for (const [label, preparedAtMs] of [
    ['older', 1_000],
    ['equal', 2_000],
    ['invalid', Number.NaN],
  ] as const) {
    const foreground = recordLastKnownServerPrices(emptyPricingSnapshotState(), {
      companyId: 34,
      partnerId: 99,
      requestedPricelistId: 104,
      capturedAtMs: 2_000,
      captureRunId: 'foreground-newer',
      validation: validServerSnapshot([[10, 44]], 82),
    });

    const activated = activatePreparedPricingRun(foreground, {
      companyId: 34,
      planId: 7,
      preparationRunId: `delayed-${label}`,
      activatedAtMs: 3_000,
      targets: [
        {
          status: 'prepared',
          partnerId: 99,
          requestedPricelistId: 104,
          snapshot: {
            preparedAtMs,
            validation: validServerSnapshot([[10, 22]], 81),
          },
        },
        {
          status: 'prepared',
          partnerId: 100,
          requestedPricelistId: 104,
          snapshot: {
            preparedAtMs: 2_500,
            validation: validServerSnapshot([[10, 55]], 83),
          },
        },
      ],
    });

    assert.deepEqual(
      activated.requestedMappings['34:99:104'],
      foreground.requestedMappings['34:99:104'],
      `${label} preparation must preserve the newer foreground mapping`,
    );
    assert.deepEqual(
      resolveCapturedCustomerPrice(activated, {
        companyId: 34,
        planId: 7,
        partnerId: 99,
        requestedPricelistId: 104,
        productId: 10,
        publicPrice: 100,
      }),
      {
        unitPrice: 44,
        source: 'last_known_customer',
        capturedAtMs: 2_000,
        pricelistId: 82,
      },
      `${label} preparation must preserve the newer foreground price`,
    );
    assert.deepEqual(activated.activeManifest?.targets, [
      {
        partnerId: 99,
        requestedPricelistId: 104,
        resolvedPricelistId: null,
        snapshotId: null,
        status: 'failed',
      },
      {
        partnerId: 100,
        requestedPricelistId: 104,
        resolvedPricelistId: 83,
        snapshotId: `delayed-${label}:34:100:83`,
        status: 'prepared',
      },
    ]);
    assert.deepEqual(activated.requestedMappings['34:100:104'], {
      companyId: 34,
      partnerId: 100,
      requestedPricelistId: 104,
      resolvedPricelistId: 83,
      preparationRunId: `delayed-${label}`,
      capturedAtMs: 2_500,
    });
    assert.deepEqual(
      resolveCapturedCustomerPrice(activated, {
        companyId: 34,
        planId: 7,
        partnerId: 100,
        requestedPricelistId: 104,
        productId: 10,
        publicPrice: 100,
      }),
      {
        unitPrice: 55,
        source: 'prepared_customer',
        capturedAtMs: 2_500,
        pricelistId: 83,
      },
    );
  }
});

test('a delayed preparation cannot bypass newer foreground pricing through a canonical alias', () => {
  const foreground = recordLastKnownServerPrices(emptyPricingSnapshotState(), {
    companyId: 34,
    partnerId: 99,
    requestedPricelistId: 105,
    capturedAtMs: 2_000,
    captureRunId: 'foreground-alias',
    validation: validServerSnapshot([[10, 44]], 81),
  });

  const activated = activatePreparedPricingRun(foreground, {
    companyId: 34,
    planId: 7,
    preparationRunId: 'delayed-other-alias',
    activatedAtMs: 3_000,
    targets: [{
      status: 'prepared',
      partnerId: 99,
      requestedPricelistId: 104,
      snapshot: {
        preparedAtMs: 1_000,
        validation: validServerSnapshot([[10, 22]], 81),
      },
    }],
  });

  assert.deepEqual(activated.activeManifest?.targets, [{
    partnerId: 99,
    requestedPricelistId: 104,
    resolvedPricelistId: null,
    snapshotId: null,
    status: 'failed',
  }]);
  assert.equal(activated.requestedMappings['34:99:104'], undefined);
  assert.deepEqual(
    resolveCapturedCustomerPrice(activated, {
      companyId: 34,
      planId: 7,
      partnerId: 99,
      requestedPricelistId: 105,
      productId: 10,
      publicPrice: 100,
    }),
    {
      unitPrice: 44,
      source: 'last_known_customer',
      capturedAtMs: 2_000,
      pricelistId: 81,
    },
  );
});

test('conflicting temporal aliases in one run cannot publish an older price', () => {
  assert.throws(
    () => activatePreparedPricingRun(emptyPricingSnapshotState(), {
      companyId: 34,
      planId: 7,
      preparationRunId: 'same-run-alias-race',
      activatedAtMs: 3_000,
      targets: [
        {
          status: 'prepared',
          partnerId: 99,
          requestedPricelistId: 104,
          snapshot: {
            preparedAtMs: 2_000,
            validation: validServerSnapshot([[10, 44]], 81),
          },
        },
        {
          status: 'prepared',
          partnerId: 99,
          requestedPricelistId: 105,
          snapshot: {
            preparedAtMs: 1_000,
            validation: validServerSnapshot([[10, 22]], 81),
          },
        },
      ],
    }),
    /Conflicting pricing snapshot candidates/,
  );
});

test('reapplying the same preparation run and payload remains idempotently prepared', () => {
  const input = {
    companyId: 34,
    planId: 7,
    preparationRunId: 'idempotent-run',
    activatedAtMs: 2_000,
    targets: [{
      status: 'prepared' as const,
      partnerId: 99,
      requestedPricelistId: 104,
      snapshot: {
        preparedAtMs: 1_000,
        validation: validServerSnapshot([[10, 42]], 81),
      },
    }],
  };
  const first = activatePreparedPricingRun(emptyPricingSnapshotState(), input);
  const replay = activatePreparedPricingRun(first, input);

  assert.equal(replay.activeManifest?.targets[0]?.status, 'prepared');
  assert.deepEqual(replay.snapshots, first.snapshots);
  assert.deepEqual(replay.requestedMappings, first.requestedMappings);
  assert.deepEqual(replay.lastKnownPrices, first.lastKnownPrices);
});

test('canonicalizes the requested pricelist before prepared lookup', () => {
  const state = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-prepared',
    preparedAtMs: 1_000,
    unitPrice: 42,
  });

  const result = resolveCapturedCustomerPrice(state, {
    companyId: 34,
    planId: 7,
    partnerId: 99,
    requestedPricelistId: 104,
    productId: 10,
    publicPrice: 100,
  });

  assert.deepEqual(result, {
    unitPrice: 42,
    source: 'prepared_customer',
    capturedAtMs: 1_000,
    pricelistId: 81,
  });
});

test('resolves prepared snapshot, exact canonical ledger, then public fallback', () => {
  const prepared = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-prepared',
    preparedAtMs: 1_000,
    unitPrice: 42,
  });
  const sameCanonical = recordLastKnownServerPrices(prepared, {
    companyId: 34,
    partnerId: 99,
    requestedPricelistId: 104,
    capturedAtMs: 2_000,
    captureRunId: 'foreground-1',
    validation: validServerSnapshot([[10, 44], [20, 55]]),
  });
  const otherCustomer = recordLastKnownServerPrices(sameCanonical, {
    companyId: 34,
    partnerId: 98,
    requestedPricelistId: 104,
    capturedAtMs: 3_000,
    captureRunId: 'other-customer',
    validation: validServerSnapshot([[30, 1]]),
  });
  const state = recordLastKnownServerPrices(otherCustomer, {
    companyId: 34,
    partnerId: 99,
    requestedPricelistId: 105,
    capturedAtMs: 3_000,
    captureRunId: 'other-pricelist',
    validation: validServerSnapshot([[30, 2]], 82),
  });
  const baseInput = {
    companyId: 34,
    planId: 7,
    partnerId: 99,
    requestedPricelistId: 104,
    publicPrice: 100,
  };

  assert.deepEqual(
    resolveCapturedCustomerPrice(state, { ...baseInput, productId: 10 }),
    {
      unitPrice: 42,
      source: 'prepared_customer',
      capturedAtMs: 1_000,
      pricelistId: 81,
    },
  );
  assert.deepEqual(
    resolveCapturedCustomerPrice(state, { ...baseInput, productId: 20 }),
    {
      unitPrice: 55,
      source: 'last_known_customer',
      capturedAtMs: 2_000,
      pricelistId: 81,
    },
  );
  assert.deepEqual(
    resolveCapturedCustomerPrice(state, { ...baseInput, productId: 30 }),
    {
      unitPrice: 100,
      source: 'public_fallback',
      capturedAtMs: null,
      pricelistId: null,
    },
  );
  assert.deepEqual(
    resolveCapturedCustomerPrice(state, {
      ...baseInput,
      planId: 8,
      productId: 10,
    }),
    {
      unitPrice: 44,
      source: 'last_known_customer',
      capturedAtMs: 2_000,
      pricelistId: 81,
    },
  );
});

test('a null requested pricelist without its own mapping cannot access customer prices', () => {
  const state = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-prepared',
    preparedAtMs: 1_000,
    unitPrice: 42,
  });

  const result = resolveCapturedCustomerPrice(state, {
    companyId: 34,
    planId: 7,
    partnerId: 99,
    requestedPricelistId: null,
    productId: 10,
    publicPrice: 100,
  });

  assert.deepEqual(result, {
    unitPrice: 100,
    source: 'public_fallback',
    capturedAtMs: null,
    pricelistId: null,
  });
});

test('two requested pricelists can share one active canonical snapshot', () => {
  const state = activatePreparedPricingRun(emptyPricingSnapshotState(), {
    companyId: 34,
    planId: 7,
    preparationRunId: 'run-shared',
    activatedAtMs: 1_001,
    targets: [
      {
        status: 'prepared',
        partnerId: 99,
        requestedPricelistId: 104,
        snapshot: {
          preparedAtMs: 1_000,
          validation: validServerSnapshot([[10, 42]]),
        },
      },
      {
        status: 'prepared',
        partnerId: 99,
        requestedPricelistId: 105,
        snapshot: {
          preparedAtMs: 900,
          validation: validServerSnapshot([[10, 42]]),
        },
      },
    ],
  });

  assert.equal(Object.keys(state.snapshots).length, 1);
  assert.equal(
    state.activeManifest?.targets[0]?.snapshotId,
    state.activeManifest?.targets[1]?.snapshotId,
  );

  for (const requestedPricelistId of [104, 105]) {
    assert.deepEqual(
      resolveCapturedCustomerPrice(state, {
        companyId: 34,
        planId: 7,
        partnerId: 99,
        requestedPricelistId,
        productId: 10,
        publicPrice: 100,
      }),
      {
        unitPrice: 42,
        source: 'prepared_customer',
        capturedAtMs: 900,
        pricelistId: 81,
      },
    );
  }
});

test('rejects conflicting candidates for one canonical snapshot atomically', () => {
  const previous = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-previous',
    preparedAtMs: 500,
    unitPrice: 40,
  });

  assert.throws(
    () => activatePreparedPricingRun(previous, {
      companyId: 34,
      planId: 7,
      preparationRunId: 'run-conflict',
      activatedAtMs: 1_001,
      targets: [
        {
          status: 'prepared',
          partnerId: 99,
          requestedPricelistId: 104,
          snapshot: {
            preparedAtMs: 1_000,
            validation: validServerSnapshot([[10, 42]]),
          },
        },
        {
          status: 'prepared',
          partnerId: 99,
          requestedPricelistId: 105,
          snapshot: {
            preparedAtMs: 1_000,
            validation: validServerSnapshot([[10, 43]]),
          },
        },
      ],
    }),
    /Conflicting pricing snapshot candidates/,
  );
  assert.equal(previous.activeManifest?.preparationRunId, 'run-previous');
  assert.equal(Object.keys(previous.snapshots).length, 1);
});

test('an older snapshot indexed by a requested key cannot override the active canonical snapshot', () => {
  const active = activateSinglePreparedTarget(emptyPricingSnapshotState(), {
    preparationRunId: 'run-active',
    preparedAtMs: 2_000,
    unitPrice: 42,
  });
  const state: PricingSnapshotStateV1 = {
    ...active,
    snapshots: {
      ...active.snapshots,
      'run-old:34:99:104': {
        version: 1,
        snapshotId: 'run-old:34:99:104',
        companyId: 34,
        partnerId: 99,
        resolvedPricelistId: 104,
        preparedAtMs: 1_000,
        preparedPlanId: 7,
        preparationRunId: 'run-old',
        origin: 'odoo_server_full',
        productFingerprint: '10',
        prices: [[10, 1]],
      },
    },
  };

  assert.deepEqual(
    resolveCapturedCustomerPrice(state, {
      companyId: 34,
      planId: 7,
      partnerId: 99,
      requestedPricelistId: 104,
      productId: 10,
      publicPrice: 100,
    }),
    {
      unitPrice: 42,
      source: 'prepared_customer',
      capturedAtMs: 2_000,
      pricelistId: 81,
    },
  );
});

test('a mixed-run replacement manifest resolves only its exact valid snapshot pointers', () => {
  const initial = activatePreparedPricingRun(emptyPricingSnapshotState(), {
    companyId: 34,
    planId: 7,
    preparationRunId: 'run-initial',
    activatedAtMs: 1_100,
    targets: [
      {
        status: 'prepared',
        partnerId: 99,
        requestedPricelistId: 81,
        snapshot: {
          preparedAtMs: 1_000,
          validation: validServerSnapshot([[10, 42]], 81),
        },
      },
      {
        status: 'failed',
        partnerId: 99,
        requestedPricelistId: 90,
      },
    ],
  });
  const replacement = replacePreparedPricingRun(initial, {
    companyId: 34,
    planId: 7,
    preparationRunId: 'run-retry',
    activatedAtMs: 2_100,
    targets: [{
      status: 'prepared',
      partnerId: 99,
      requestedPricelistId: 90,
      snapshot: {
        preparedAtMs: 2_000,
        validation: validServerSnapshot([[10, 55]], 90),
      },
    }],
  });

  assert.deepEqual(
    replacement.activeManifest?.targets.map((target) => target.snapshotId),
    ['run-initial:34:99:81', 'run-retry:34:99:90'],
  );
  assert.equal(
    resolveCapturedCustomerPrice(replacement, {
      companyId: 34,
      planId: 7,
      partnerId: 99,
      requestedPricelistId: 81,
      productId: 10,
      publicPrice: 100,
    }).source,
    'prepared_customer',
  );
  assert.equal(
    resolveCapturedCustomerPrice(replacement, {
      companyId: 34,
      planId: 7,
      partnerId: 99,
      requestedPricelistId: 90,
      productId: 10,
      publicPrice: 100,
    }).source,
    'prepared_customer',
  );

  const pointedTarget = replacement.activeManifest!.targets[0]!;
  const pointedSnapshot = replacement.snapshots[pointedTarget.snapshotId!]!;
  const forgedSnapshotId = 'forged-run:34:99:81';
  const identityInconsistent: PricingSnapshotStateV1 = {
    ...replacement,
    activeManifest: {
      ...replacement.activeManifest!,
      targets: [
        {
          ...pointedTarget,
          snapshotId: forgedSnapshotId,
        },
        replacement.activeManifest!.targets[1]!,
      ],
    },
    snapshots: {
      ...replacement.snapshots,
      [forgedSnapshotId]: {
        ...pointedSnapshot,
        snapshotId: forgedSnapshotId,
      },
    },
  };

  assert.notEqual(
    resolveCapturedCustomerPrice(identityInconsistent, {
      companyId: 34,
      planId: 7,
      partnerId: 99,
      requestedPricelistId: 81,
      productId: 10,
      publicPrice: 100,
    }).source,
    'prepared_customer',
  );
  assert.equal(
    resolveCapturedCustomerPrice(identityInconsistent, {
      companyId: 34,
      planId: 7,
      partnerId: 99,
      requestedPricelistId: 90,
      productId: 10,
      publicPrice: 100,
    }).source,
    'prepared_customer',
  );
});
