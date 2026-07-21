import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifySaleSubmissionError,
  readSaleSubmissionErrorMetadata,
  type SaleSubmissionOutcomeKind,
} from '../src/services/saleSubmissionOutcome.ts';

test('reads supported primitive metadata from an Error', () => {
  const error = Object.assign(new Error('Falló la venta.'), {
    httpStatus: 422,
    responseReceived: true,
    code: 'validation_error',
  });

  assert.deepEqual(readSaleSubmissionErrorMetadata(error), {
    httpStatus: 422,
    responseReceived: true,
    code: 'validation_error',
    name: 'Error',
    message: 'Falló la venta.',
  });
});

test('reads plain objects and string errors without trusting non-primitive fields', () => {
  assert.deepEqual(
    readSaleSubmissionErrorMetadata({
      httpStatus: '422',
      responseReceived: 1,
      code: ['timeout'],
      name: 'AbortError',
      message: 'cancelled',
    }),
    { name: 'AbortError', message: 'cancelled' },
  );
  assert.deepEqual(readSaleSubmissionErrorMetadata('network unavailable'), {
    message: 'network unavailable',
  });
});

test('does not throw while reading unusual unknown values', () => {
  const hostile = new Proxy({}, {
    get() {
      throw new Error('property access denied');
    },
  });

  assert.doesNotThrow(() => readSaleSubmissionErrorMetadata(hostile));
  assert.deepEqual(readSaleSubmissionErrorMetadata(hostile), {});
  assert.deepEqual(readSaleSubmissionErrorMetadata(null), {});
  assert.deepEqual(readSaleSubmissionErrorMetadata(42), {});
});

const classificationCases: Array<{
  name: string;
  error: unknown;
  expected: SaleSubmissionOutcomeKind;
}> = [
  {
    name: 'HTTP 503 takes precedence over a functional code',
    error: { httpStatus: 503, code: 'insufficient_stock', responseReceived: true },
    expected: 'ambiguous_result',
  },
  {
    name: 'a request with no response is ambiguous even with HTTP-like metadata',
    error: { httpStatus: 422, responseReceived: false },
    expected: 'ambiguous_result',
  },
  {
    name: 'timeout code',
    error: { code: 'timeout' },
    expected: 'ambiguous_result',
  },
  {
    name: 'AbortError name',
    error: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    expected: 'ambiguous_result',
  },
  {
    name: 'invalid response despite receiving a response',
    error: { code: 'invalid_response', responseReceived: true },
    expected: 'ambiguous_result',
  },
  {
    name: 'HTTP 422 rejection',
    error: { httpStatus: 422, responseReceived: true },
    expected: 'definitive_rejection',
  },
  {
    name: 'insufficient stock functional rejection',
    error: { code: 'insufficient_stock', responseReceived: true },
    expected: 'definitive_rejection',
  },
  {
    name: 'expired session functional rejection',
    error: { code: 'session_expired', responseReceived: true },
    expected: 'definitive_rejection',
  },
  {
    name: 'API functional rejection',
    error: { code: 'api_rejection', responseReceived: true },
    expected: 'definitive_rejection',
  },
  {
    name: 'functional code wins over timeout-like business validation text',
    error: {
      code: 'api_rejection',
      responseReceived: true,
      message: 'validation timeout must be positive',
    },
    expected: 'definitive_rejection',
  },
  {
    name: 'HTTP rejection wins over connection-like business validation text',
    error: {
      httpStatus: 422,
      responseReceived: true,
      message: 'connection value is invalid',
    },
    expected: 'definitive_rejection',
  },
  {
    name: 'network message without response metadata',
    error: new Error('Network request failed'),
    expected: 'ambiguous_result',
  },
  {
    name: 'localized business text alone is not a definitive rejection',
    error: new Error('Stock insuficiente para el producto.'),
    expected: 'ambiguous_result',
  },
  {
    name: 'unknown Error',
    error: new Error('Unexpected failure'),
    expected: 'ambiguous_result',
  },
];

for (const classificationCase of classificationCases) {
  test(`classifies ${classificationCase.name}`, () => {
    assert.deepEqual(classifySaleSubmissionError(classificationCase.error), {
      kind: classificationCase.expected,
    });
  });
}
