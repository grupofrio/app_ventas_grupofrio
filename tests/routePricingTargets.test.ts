import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRoutePricingTargets,
} from '../src/services/routePricingTargets.ts';

test('builds stable exact customer and requested-pricelist targets', () => {
  const targets = buildRoutePricingTargets([
    { customer_id: 99, _pricelistId: 81 },
    { customer_id: 99, _pricelistId: 81 },
    { customer_id: 99, _pricelistId: 90 },
    { customer_id: 100, _pricelistId: null },
    { customer_id: 99, _pricelistId: null },
    { customer_id: 100, _pricelistId: null },
  ]);

  assert.deepEqual(targets, [
    { partnerId: 99, requestedPricelistId: 81 },
    { partnerId: 99, requestedPricelistId: 90 },
    { partnerId: 100, requestedPricelistId: null },
    { partnerId: 99, requestedPricelistId: null },
  ]);
});

test('drops invalid partner IDs without disturbing valid target order', () => {
  const targets = buildRoutePricingTargets([
    { customer_id: 0, _pricelistId: 81 },
    { customer_id: -1, _pricelistId: 81 },
    { customer_id: 1.5, _pricelistId: 81 },
    { customer_id: Number.POSITIVE_INFINITY, _pricelistId: 81 },
    { customer_id: '99', _pricelistId: 81 },
    { customer_id: 101, _pricelistId: 90 },
    { customer_id: 102, _pricelistId: null },
  ]);

  assert.deepEqual(targets, [
    { partnerId: 101, requestedPricelistId: 90 },
    { partnerId: 102, requestedPricelistId: null },
  ]);
});

test('drops explicitly invalid requested-pricelist values instead of aliasing them to null', () => {
  const targets = buildRoutePricingTargets([
    { customer_id: 99, _pricelistId: null },
    { customer_id: 99, _pricelistId: 0 },
    { customer_id: 99, _pricelistId: -1 },
    { customer_id: 99, _pricelistId: 81.5 },
    { customer_id: 99, _pricelistId: Number.NaN },
    { customer_id: 99, _pricelistId: '81' },
    { customer_id: 100, _pricelistId: 81 },
  ]);

  assert.deepEqual(targets, [
    { partnerId: 99, requestedPricelistId: null },
    { partnerId: 100, requestedPricelistId: 81 },
  ]);
});
