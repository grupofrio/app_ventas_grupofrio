import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
