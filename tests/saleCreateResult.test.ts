import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSaleCreateResult } from '../src/services/saleCreateResult.ts';

test('returns validated sale data for a newly created order', () => {
  const data = {
    success: true as const,
    order_id: 81,
    name: 'S00042',
    operation_id: 'sale-op-1',
    duplicate: false,
    backend_marker: 'preserved',
  };
  const result = {
    ok: true,
    message: 'Venta creada y confirmada.',
    data,
  };

  const validated = validateSaleCreateResult(result, 'sale-op-1');

  assert.notEqual(validated, data);
  assert.deepEqual(validated, data);
  assert.equal(validated.name, 'S00042');
});

test('accepts duplicate responses as idempotent success', () => {
  const data = {
    success: true as const,
    order_id: 81,
    name: 'S00042',
    operation_id: 'sale-op-1',
    duplicate: true,
  };

  const validated = validateSaleCreateResult(
    { ok: true, message: 'Venta ya creada.', data },
    'sale-op-1',
  );

  assert.notEqual(validated, data);
  assert.deepEqual(validated, data);
  assert.equal(validated.name, 'S00042');
});

test('trims the authoritative sale name while preserving all response data fields', () => {
  const data = {
    success: true as const,
    order_id: 81,
    name: '  S00042  ',
    operation_id: 'sale-op-1',
    duplicate: false,
    backend_marker: 'preserved',
  };

  const validated = validateSaleCreateResult({ ok: true, data }, 'sale-op-1');

  assert.notEqual(validated, data);
  assert.deepEqual(validated, { ...data, name: 'S00042' });
});

test('accepts only the server payment decision expected for a Kold Field sale', () => {
  const data = {
    success: true as const,
    order_id: 81,
    name: 'S00042',
    operation_id: 'sale-op-1',
    payment_method: 'credit',
    payment_review_required: true,
    payment_review_reason: 'credit_hold',
  };
  const validated = validateSaleCreateResult({ ok: true, data }, 'sale-op-1');
  assert.equal(validated.payment_method, 'credit');
  assert.equal(validated.payment_review_required, true);
  assert.equal(validated.payment_review_reason, 'credit_hold');

  assert.throws(
    () => validateSaleCreateResult({
      ok: true,
      data: { ...data, payment_method: 'transfer' },
    }, 'sale-op-1'),
    /Respuesta inválida al confirmar la venta/,
  );
});

test('sanitizes exceptions thrown while inspecting the response envelope', () => {
  const result = new Proxy({}, {
    get(_target, property) {
      throw new Error(`raw-envelope-secret:${String(property)}`);
    },
  });

  assert.throws(
    () => validateSaleCreateResult(result, 'sale-op-1'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const metadata = error as Error & { code?: unknown; responseReceived?: unknown };
      assert.equal(metadata.message, 'Respuesta inválida al confirmar la venta.');
      assert.equal(metadata.code, 'invalid_response');
      assert.equal(metadata.responseReceived, true);
      assert.doesNotMatch(metadata.message, /raw-envelope-secret/i);
      return true;
    },
  );
});

test('sanitizes exceptions thrown while inspecting response data', () => {
  const data = new Proxy({}, {
    get(_target, property) {
      throw new Error(`raw-customer-secret:${String(property)}`);
    },
  });

  assert.throws(
    () => validateSaleCreateResult({ ok: true, data }, 'sale-op-1'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const metadata = error as Error & { code?: unknown; responseReceived?: unknown };
      assert.equal(metadata.message, 'Respuesta inválida al confirmar la venta.');
      assert.equal(metadata.code, 'invalid_response');
      assert.equal(metadata.responseReceived, true);
      assert.doesNotMatch(metadata.message, /raw-customer-secret/i);
      return true;
    },
  );
});

const invalidCases: Array<{
  name: string;
  result: unknown;
  expectedOperationId: string;
}> = [
  { name: 'null response', result: null, expectedOperationId: 'sale-op-1' },
  { name: 'empty object', result: {}, expectedOperationId: 'sale-op-1' },
  { name: 'raw HTML response', result: { raw: '<html>private</html>' }, expectedOperationId: 'sale-op-1' },
  {
    name: 'ok is false',
    result: {
      ok: false,
      data: { success: true, order_id: 81, name: 'S00042', operation_id: 'sale-op-1' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'ok is not boolean true',
    result: {
      ok: 1,
      data: { success: true, order_id: 81, name: 'S00042', operation_id: 'sale-op-1' },
    },
    expectedOperationId: 'sale-op-1',
  },
  { name: 'missing data', result: { ok: true }, expectedOperationId: 'sale-op-1' },
  { name: 'null data', result: { ok: true, data: null }, expectedOperationId: 'sale-op-1' },
  { name: 'array data', result: { ok: true, data: [] }, expectedOperationId: 'sale-op-1' },
  {
    name: 'data success is missing',
    result: { ok: true, data: { order_id: 81, name: 'S00042', operation_id: 'sale-op-1' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'data success is false',
    result: {
      ok: true,
      data: { success: false, order_id: 81, name: 'S00042', operation_id: 'sale-op-1' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'order id is a string',
    result: {
      ok: true,
      data: { success: true, order_id: '81', name: 'S00042', operation_id: 'sale-op-1' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'order id is fractional',
    result: {
      ok: true,
      data: { success: true, order_id: 81.5, name: 'S00042', operation_id: 'sale-op-1' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'order id is zero',
    result: {
      ok: true,
      data: { success: true, order_id: 0, name: 'S00042', operation_id: 'sale-op-1' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'order id is negative',
    result: {
      ok: true,
      data: { success: true, order_id: -1, name: 'S00042', operation_id: 'sale-op-1' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'sale name is missing',
    result: { ok: true, data: { success: true, order_id: 81, operation_id: 'sale-op-1' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'sale name is empty',
    result: {
      ok: true,
      data: { success: true, order_id: 81, name: '', operation_id: 'sale-op-1' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'sale name is whitespace',
    result: {
      ok: true,
      data: { success: true, order_id: 81, name: '   ', operation_id: 'sale-op-1' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'sale name is not a string',
    result: {
      ok: true,
      data: { success: true, order_id: 81, name: 42, operation_id: 'sale-op-1' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'duplicate marker is not boolean',
    result: {
      ok: true,
      data: {
        success: true,
        order_id: 81,
        name: 'S00042',
        operation_id: 'sale-op-1',
        duplicate: 'true',
      },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'expected operation id is empty',
    result: {
      ok: true,
      data: { success: true, order_id: 81, name: 'S00042', operation_id: 'sale-op-1' },
    },
    expectedOperationId: '',
  },
  {
    name: 'expected operation id is whitespace',
    result: {
      ok: true,
      data: { success: true, order_id: 81, name: 'S00042', operation_id: 'sale-op-1' },
    },
    expectedOperationId: '   ',
  },
  {
    name: 'response operation id is missing',
    result: { ok: true, data: { success: true, order_id: 81, name: 'S00042' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'response operation id is empty',
    result: {
      ok: true,
      data: { success: true, order_id: 81, name: 'S00042', operation_id: '' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'response operation id is whitespace',
    result: {
      ok: true,
      data: { success: true, order_id: 81, name: 'S00042', operation_id: '   ' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'response operation id does not match',
    result: {
      ok: true,
      data: { success: true, order_id: 81, name: 'S00042', operation_id: 'sale-op-2' },
    },
    expectedOperationId: 'sale-op-1',
  },
];

for (const invalidCase of invalidCases) {
  test(`rejects ${invalidCase.name} with sanitized response metadata`, () => {
    assert.throws(
      () => validateSaleCreateResult(invalidCase.result, invalidCase.expectedOperationId),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const metadata = error as Error & { code?: unknown; responseReceived?: unknown };
        assert.equal(metadata.message, 'Respuesta inválida al confirmar la venta.');
        assert.equal(metadata.code, 'invalid_response');
        assert.equal(metadata.responseReceived, true);
        assert.doesNotMatch(metadata.message, /private|sale-op|<html>/i);
        assert.equal('data' in metadata, false);
        assert.equal('response' in metadata, false);
        return true;
      },
    );
  });
}
