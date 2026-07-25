import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLatestProductPricingRequestGate,
  createProductPricingInFlightLoader,
  createProductSelectionCommitGuard,
  decideProductSelectionReadiness,
  selectProductPrice,
  type ProductPriceSelectionInput,
} from '../src/services/productPriceSelection.ts';

test('offline prepared customer price does not require public fallback confirmation', () => {
  const decision = selectProductPrice({
    isOnline: false,
    snapshotPrice: {
      unitPrice: 42,
      source: 'prepared_customer',
      capturedAtMs: 1_000,
      pricelistId: 81,
    },
    publicPrice: 100,
  });

  assert.equal(decision.requiresPublicFallbackConfirmation, false);
  assert.equal(decision.price.unitPrice, 42);
  assert.equal(decision.price.source, 'prepared_customer');
});

test('offline same-list last-known price does not require confirmation', () => {
  const decision = selectProductPrice({
    isOnline: false,
    snapshotPrice: {
      unitPrice: 55,
      source: 'last_known_customer',
      capturedAtMs: 2_000,
      pricelistId: 81,
    },
    publicPrice: 100,
  });

  assert.equal(decision.requiresPublicFallbackConfirmation, false);
  assert.deepEqual(decision.price, {
    unitPrice: 55,
    source: 'last_known_customer',
    capturedAtMs: 2_000,
    pricelistId: 81,
  });
});

test('offline public fallback requires confirmation and retains public metadata', () => {
  const decision = selectProductPrice({
    isOnline: false,
    snapshotPrice: {
      unitPrice: 100,
      source: 'public_fallback',
      capturedAtMs: null,
      pricelistId: null,
    },
    publicPrice: 100,
  });

  assert.equal(decision.requiresPublicFallbackConfirmation, true);
  assert.deepEqual(decision.price, {
    unitPrice: 100,
    source: 'public_fallback',
    capturedAtMs: null,
    pricelistId: null,
  });
});

test('online server-selected price never requires offline fallback confirmation', () => {
  const decision = selectProductPrice({
    isOnline: true,
    snapshotPrice: {
      unitPrice: 100,
      source: 'last_known_customer',
      capturedAtMs: 3_000,
      pricelistId: 81,
    },
    publicPrice: 100,
  });

  assert.equal(decision.requiresPublicFallbackConfirmation, false);
  assert.equal(decision.price.unitPrice, 100);
  assert.equal(decision.price.source, 'last_known_customer');
});

test('missing snapshot price selects an explicit public fallback', () => {
  const decision = selectProductPrice({
    isOnline: false,
    snapshotPrice: null,
    publicPrice: 88,
  });

  assert.deepEqual(decision, {
    price: {
      unitPrice: 88,
      source: 'public_fallback',
      capturedAtMs: null,
      pricelistId: null,
    },
    requiresPublicFallbackConfirmation: true,
  });
});

test('non-finite and negative selected prices are rejected', () => {
  for (const unitPrice of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0.01,
  ]) {
    assert.throws(
      () => selectProductPrice({
        isOnline: false,
        snapshotPrice: {
          unitPrice,
          source: 'prepared_customer',
          capturedAtMs: 1_000,
          pricelistId: 81,
        },
        publicPrice: 100,
      }),
      /invalid selected product price/,
    );
  }
});

test('non-finite and negative public fallbacks are rejected', () => {
  for (const publicPrice of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
  ]) {
    assert.throws(
      () => selectProductPrice({
        isOnline: false,
        snapshotPrice: null,
        publicPrice,
      }),
      /invalid public product price/,
    );
  }
});

test('selection is pure and does not mutate its input', () => {
  const input: ProductPriceSelectionInput = Object.freeze({
    isOnline: false,
    snapshotPrice: Object.freeze({
      unitPrice: 42,
      source: 'prepared_customer' as const,
      capturedAtMs: 1_000,
      pricelistId: 81,
    }),
    publicPrice: 100,
  });

  const first = selectProductPrice(input);
  const second = selectProductPrice(input);

  assert.deepEqual(first, second);
  assert.deepEqual(input.snapshotPrice, {
    unitPrice: 42,
    source: 'prepared_customer',
    capturedAtMs: 1_000,
    pricelistId: 81,
  });
});

test('latest pricing request wins when overlapping responses resolve out of order', async () => {
  const gate = createLatestProductPricingRequestGate();
  const published: string[] = [];
  let resolveOlder!: (value: string) => void;
  let resolveNewer!: (value: string) => void;
  const olderResponse = new Promise<string>((resolve) => {
    resolveOlder = resolve;
  });
  const newerResponse = new Promise<string>((resolve) => {
    resolveNewer = resolve;
  });
  const older = gate.begin('company=34|partner=99|list=81|products=10', {
    capturedAtMs: 1_000,
    captureRunId: 'picker:1000',
  });
  const publishOlder = olderResponse.then((value) => {
    if (gate.isCurrent(older)) published.push(value);
  });
  const newer = gate.begin('company=34|partner=99|list=81|products=10', {
    capturedAtMs: 1_001,
    captureRunId: 'picker:1001',
  });
  const publishNewer = newerResponse.then((value) => {
    if (gate.isCurrent(newer)) published.push(value);
  });

  resolveNewer('newer');
  await publishNewer;
  resolveOlder('older');
  await publishOlder;

  assert.deepEqual(published, ['newer']);
  assert.equal(older.capture.capturedAtMs, 1_000);
  assert.equal(newer.capture.capturedAtMs, 1_001);
});

test('context invalidation rejects an in-flight request for both UI and ledger publication', () => {
  const gate = createLatestProductPricingRequestGate();
  const request = gate.begin('company=34|partner=99|list=81|products=10', {
    capturedAtMs: 1_000,
    captureRunId: 'picker:1000',
  });

  gate.invalidate();

  assert.equal(gate.isCurrent(request), false);
  assert.equal(gate.cancel(request), false);
});

test('cancelling an older request cannot invalidate a newer request', () => {
  const gate = createLatestProductPricingRequestGate();
  const older = gate.begin('customer-a', {
    capturedAtMs: 1_000,
    captureRunId: 'picker:1000',
  });
  const newer = gate.begin('customer-b', {
    capturedAtMs: 1_001,
    captureRunId: 'picker:1001',
  });

  assert.equal(gate.cancel(older), false);
  assert.equal(gate.isCurrent(newer), true);
});

test('strict persistence lease delays a switched context until save-before-publish completes', async () => {
  const gate = createLatestProductPricingRequestGate();
  const saveStarted = Promise.withResolvers<void>();
  const releaseSave = Promise.withResolvers<void>();
  const activationOrder: string[] = [];
  let durableLedger = 'initial';
  let publishedLedger = 'initial';

  const older = gate.begin('company=34|partner=99|list=81|products=10', {
    capturedAtMs: 1_000,
    captureRunId: 'picker:1000',
  });
  const olderCommit = gate.runCommitIfCurrent(older, async () => {
    saveStarted.resolve();
    await releaseSave.promise;
    durableLedger = 'customer-a';
    publishedLedger = 'customer-a';
    activationOrder.push('older-published');
  });
  await saveStarted.promise;

  // Reproduce a prop/context switch while saveStrict is still awaiting:
  // effect cleanup invalidates A, then the next effect begins B.
  gate.invalidate();
  const newer = gate.begin('company=34|partner=100|list=82|products=10', {
    capturedAtMs: 1_001,
    captureRunId: 'picker:1001',
  });
  const newerActivation = gate.waitUntilCurrent(newer).then((activated) => {
    if (activated) activationOrder.push('newer-active');
    return activated;
  });

  assert.equal(gate.isCurrent(older), false, 'old UI must be stale immediately');
  assert.equal(gate.isCurrent(newer), false, 'new context waits behind strict persistence');
  assert.equal(durableLedger, 'initial');
  assert.equal(publishedLedger, 'initial');

  releaseSave.resolve();
  assert.equal(await olderCommit, true);
  assert.equal(await newerActivation, true);
  assert.deepEqual(activationOrder, ['older-published', 'newer-active']);
  assert.equal(durableLedger, 'customer-a');
  assert.equal(publishedLedger, 'customer-a');
  assert.equal(gate.isCurrent(newer), true);

  const newerCommit = await gate.runCommitIfCurrent(newer, async () => {
    durableLedger = 'customer-b';
    publishedLedger = 'customer-b';
  });
  assert.equal(newerCommit, true, 'subsequent context must proceed after the lease');
  assert.equal(durableLedger, 'customer-b');
  assert.equal(publishedLedger, 'customer-b');
});

test('a pending request superseded during strict persistence never activates', async () => {
  const gate = createLatestProductPricingRequestGate();
  const saveStarted = Promise.withResolvers<void>();
  const releaseSave = Promise.withResolvers<void>();
  const older = gate.begin('customer-a', {
    capturedAtMs: 1_000,
    captureRunId: 'picker:1000',
  });
  const olderCommit = gate.runCommitIfCurrent(older, async () => {
    saveStarted.resolve();
    await releaseSave.promise;
  });
  await saveStarted.promise;

  const superseded = gate.begin('customer-b', {
    capturedAtMs: 1_001,
    captureRunId: 'picker:1001',
  });
  const supersededActivation = gate.waitUntilCurrent(superseded);
  const latest = gate.begin('customer-c', {
    capturedAtMs: 1_002,
    captureRunId: 'picker:1002',
  });
  const latestActivation = gate.waitUntilCurrent(latest);

  assert.equal(await supersededActivation, false);
  releaseSave.resolve();
  assert.equal(await olderCommit, true);
  assert.equal(await latestActivation, true);
  assert.equal(gate.isCurrent(latest), true);
});

test('selection commit guard invokes a direct add sink at most once', () => {
  const guard = createProductSelectionCommitGuard();
  const token = guard.begin('visible=1|partner=99|product=10');
  assert.ok(token);
  let onAddLineCalls = 0;
  const add = () => {
    onAddLineCalls += 1;
  };

  assert.equal(guard.commit(token, add), true);
  assert.equal(guard.commit(token, add), false, 'same callback may fire twice');
  assert.equal(
    guard.begin('visible=1|partner=99|product=10'),
    null,
    'a second tap before the picker context changes must remain blocked',
  );
  assert.equal(onAddLineCalls, 1);
});

test('selection commit guard resets uncommitted attempts on cancel and context change', () => {
  const guard = createProductSelectionCommitGuard();
  const cancelled = guard.begin('visible=1|partner=99|product=10');
  assert.ok(cancelled);
  assert.equal(guard.cancel(cancelled), true);

  const afterCancel = guard.begin('visible=1|partner=99|product=10');
  assert.ok(afterCancel, 'public fallback cancel must permit another attempt');
  assert.equal(guard.cancelUncommitted(), true, 'manual close clears a pending attempt');

  const oldContext = guard.begin('visible=1|partner=99|product=10');
  assert.ok(oldContext);
  guard.invalidate();
  const newContext = guard.begin('visible=1|partner=100|product=10');
  assert.ok(newContext, 'prop/context switch must permit a fresh selection');
  assert.equal(guard.commit(oldContext, () => assert.fail('stale sink ran')), false);
});

test('online customer pricing is not selectable before an exact context is published', () => {
  const pending = decideProductSelectionReadiness({
    isOnline: true,
    partnerId: 99,
    publishedPricingContextKey: null,
    currentPricingContextKey: 'company=34|partner=99|list=81',
    isRefreshing: false,
  });
  const switchedContext = decideProductSelectionReadiness({
    isOnline: true,
    partnerId: 100,
    publishedPricingContextKey: 'company=34|partner=99|list=81',
    currentPricingContextKey: 'company=34|partner=100|list=82',
    isRefreshing: false,
  });

  assert.deepEqual(pending, {
    canSelect: false,
    isWaitingForCustomerPrice: true,
    isRefreshingCustomerPrice: false,
  });
  assert.deepEqual(switchedContext, pending);
});

test('an exact cached, full-response, or settled fallback context is selectable online', () => {
  const exactContext = 'company=34|partner=99|list=81';

  for (const settledSource of [
    'exact cached compatibility result',
    'strict full response',
    'settled client-only fallback',
  ]) {
    assert.deepEqual(
      decideProductSelectionReadiness({
        isOnline: true,
        partnerId: 99,
        publishedPricingContextKey: exactContext,
        currentPricingContextKey: exactContext,
        isRefreshing: false,
      }),
      {
        canSelect: true,
        isWaitingForCustomerPrice: false,
        isRefreshingCustomerPrice: false,
      },
      settledSource,
    );
  }
});

test('offline and partnerless online public-price flows remain selectable', () => {
  for (const input of [
    {
      isOnline: false,
      partnerId: 99,
      publishedPricingContextKey: null,
      currentPricingContextKey: 'offline-customer',
      isRefreshing: false,
    },
    {
      isOnline: true,
      partnerId: null,
      publishedPricingContextKey: null,
      currentPricingContextKey: 'partnerless',
      isRefreshing: false,
    },
  ]) {
    assert.equal(decideProductSelectionReadiness(input).canSelect, true);
    assert.equal(
      decideProductSelectionReadiness(input).isWaitingForCustomerPrice,
      false,
    );
  }
});

test('refresh keeps an exact settled context selectable but still blocks an unmatched context', () => {
  const exactContext = 'company=34|partner=99|list=81';
  const exactRefresh = decideProductSelectionReadiness({
    isOnline: true,
    partnerId: 99,
    publishedPricingContextKey: exactContext,
    currentPricingContextKey: exactContext,
    isRefreshing: true,
  });
  const pendingRefresh = decideProductSelectionReadiness({
    isOnline: true,
    partnerId: 99,
    publishedPricingContextKey: null,
    currentPricingContextKey: exactContext,
    isRefreshing: true,
  });

  assert.deepEqual(exactRefresh, {
    canSelect: true,
    isWaitingForCustomerPrice: false,
    isRefreshingCustomerPrice: true,
  });
  assert.deepEqual(pendingRefresh, {
    canSelect: false,
    isWaitingForCustomerPrice: true,
    isRefreshingCustomerPrice: false,
  });
});

test('forced pricing request replaces an in-flight entry without older cleanup or publication winning', async () => {
  const loader = createProductPricingInFlightLoader();
  const gate = createLatestProductPricingRequestGate();
  const initialResponse = Promise.withResolvers<string>();
  const forcedResponse = Promise.withResolvers<string>();
  const published: string[] = [];
  let transportCalls = 0;

  const initialToken = gate.begin('same-context', {
    capturedAtMs: 1_000,
    captureRunId: 'picker:1000',
  });
  const initial = loader.run('same-context', () => {
    transportCalls += 1;
    return initialResponse.promise;
  });
  const initialPublication = initial.then((value) => {
    if (gate.isCurrent(initialToken)) published.push(value);
  });

  const forcedToken = gate.begin('same-context', {
    capturedAtMs: 1_001,
    captureRunId: 'picker:1001',
  });
  const forced = loader.run('same-context', () => {
    transportCalls += 1;
    return forcedResponse.promise;
  }, { force: true });
  const forcedPublication = forced.then((value) => {
    if (gate.isCurrent(forcedToken)) published.push(value);
  });

  assert.equal(transportCalls, 2, 'forced refresh must start a second request');
  assert.notEqual(forced, initial);

  initialResponse.resolve('initial');
  await initialPublication;
  const stillForced = loader.run('same-context', () => {
    transportCalls += 1;
    return Promise.resolve('unexpected-third-request');
  });
  assert.equal(stillForced, forced, 'older finally must not delete the forced entry');
  assert.deepEqual(published, [], 'older response must not publish through the gate');
  assert.equal(transportCalls, 2);

  forcedResponse.resolve('forced');
  await forcedPublication;
  assert.deepEqual(published, ['forced']);
});
