import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSaleCreateResult } from '../src/services/saleCreateResult.ts';

test('returns validated sale data for a newly created order', () => {
  const data = {
    success: true as const,
    order_id: 81,
    operation_id: 'sale-op-1',
    duplicate: false,
  };
  const result = {
    ok: true,
    message: 'Venta creada y confirmada.',
    data,
  };

  assert.equal(validateSaleCreateResult(result, 'sale-op-1'), data);
});

test('accepts duplicate responses as idempotent success', () => {
  const data = {
    success: true as const,
    order_id: 81,
    operation_id: 'sale-op-1',
    duplicate: true,
  };

  assert.equal(
    validateSaleCreateResult({ ok: true, message: 'Venta ya creada.', data }, 'sale-op-1'),
    data,
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
    result: { ok: false, data: { success: true, order_id: 81, operation_id: 'sale-op-1' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'ok is not boolean true',
    result: { ok: 1, data: { success: true, order_id: 81, operation_id: 'sale-op-1' } },
    expectedOperationId: 'sale-op-1',
  },
  { name: 'missing data', result: { ok: true }, expectedOperationId: 'sale-op-1' },
  { name: 'null data', result: { ok: true, data: null }, expectedOperationId: 'sale-op-1' },
  { name: 'array data', result: { ok: true, data: [] }, expectedOperationId: 'sale-op-1' },
  {
    name: 'data success is missing',
    result: { ok: true, data: { order_id: 81, operation_id: 'sale-op-1' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'data success is false',
    result: { ok: true, data: { success: false, order_id: 81, operation_id: 'sale-op-1' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'order id is a string',
    result: { ok: true, data: { success: true, order_id: '81', operation_id: 'sale-op-1' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'order id is fractional',
    result: { ok: true, data: { success: true, order_id: 81.5, operation_id: 'sale-op-1' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'order id is zero',
    result: { ok: true, data: { success: true, order_id: 0, operation_id: 'sale-op-1' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'order id is negative',
    result: { ok: true, data: { success: true, order_id: -1, operation_id: 'sale-op-1' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'duplicate marker is not boolean',
    result: {
      ok: true,
      data: { success: true, order_id: 81, operation_id: 'sale-op-1', duplicate: 'true' },
    },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'expected operation id is empty',
    result: { ok: true, data: { success: true, order_id: 81, operation_id: 'sale-op-1' } },
    expectedOperationId: '',
  },
  {
    name: 'expected operation id is whitespace',
    result: { ok: true, data: { success: true, order_id: 81, operation_id: 'sale-op-1' } },
    expectedOperationId: '   ',
  },
  {
    name: 'response operation id is missing',
    result: { ok: true, data: { success: true, order_id: 81 } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'response operation id is empty',
    result: { ok: true, data: { success: true, order_id: 81, operation_id: '' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'response operation id is whitespace',
    result: { ok: true, data: { success: true, order_id: 81, operation_id: '   ' } },
    expectedOperationId: 'sale-op-1',
  },
  {
    name: 'response operation id does not match',
    result: { ok: true, data: { success: true, order_id: 81, operation_id: 'sale-op-2' } },
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
