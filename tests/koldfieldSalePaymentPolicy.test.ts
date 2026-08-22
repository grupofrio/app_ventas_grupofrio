import assert from 'node:assert/strict';
import test from 'node:test';
import {
  presentKoldFieldSalePaymentPolicy,
  salePaymentPresentationFromDayBundle,
} from '../src/services/koldfieldSalePaymentPolicy.ts';

test('uses Contado for normal customers', () => {
  assert.deepEqual(
    presentKoldFieldSalePaymentPolicy({ mode: 'cash_only' }),
    { method: 'cash', label: 'Contado', reviewRequired: false },
  );
});

test('uses Crédito only for customers explicitly configured for credit', () => {
  assert.deepEqual(
    presentKoldFieldSalePaymentPolicy({ mode: 'credit_allowed' }),
    { method: 'credit', label: 'Crédito', reviewRequired: false },
  );
});

test('keeps blocked customers sellable on credit with a review signal', () => {
  assert.deepEqual(
    presentKoldFieldSalePaymentPolicy({ mode: 'blocked' }),
    { method: 'credit', label: 'Crédito · revisar', reviewRequired: true },
  );
});

test('fails safely to Contado · revisar for absent or unknown policy without manufacturing credit data', () => {
  assert.deepEqual(
    presentKoldFieldSalePaymentPolicy(undefined),
    { method: 'cash', label: 'Contado · revisar', reviewRequired: true },
  );
  assert.deepEqual(
    presentKoldFieldSalePaymentPolicy({ mode: 'unexpected', credit_used: -12 }),
    { method: 'cash', label: 'Contado · revisar', reviewRequired: true },
  );
});

test('reads the policy from the authorized route stop before using directory fallback for an off-route customer', () => {
  assert.deepEqual(
    salePaymentPresentationFromDayBundle({
      stopId: 41,
      customerId: 700,
      stops: [{ id: 41, payment_policy: { mode: 'credit_allowed' } }],
      directory: [{ id: 700, payment_policy: { mode: 'cash_only' } }],
    }),
    { method: 'credit', label: 'Crédito', reviewRequired: false },
  );
  assert.deepEqual(
    salePaymentPresentationFromDayBundle({
      stopId: -41,
      customerId: 700,
      stops: [],
      directory: [{ id: 700, payment_policy: { mode: 'blocked' } }],
    }),
    { method: 'credit', label: 'Crédito · revisar', reviewRequired: true },
  );
});
