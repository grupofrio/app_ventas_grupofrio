import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRetrySyncItemError } from '../src/services/syncRetryDecision.ts';

function withMeta<T extends Record<string, unknown>>(metadata: T): Error & T {
  return Object.assign(new Error('structured sync failure'), metadata);
}

const cases = [
  {
    name: 'retries a sale with an invalid response',
    type: 'sale_order' as const,
    error: withMeta({ code: 'invalid_response' }),
    expected: true,
  },
  {
    name: 'retries a sale with an unknown error',
    type: 'sale_order' as const,
    error: new Error('unknown'),
    expected: true,
  },
  {
    name: 'retries a sale after HTTP 503',
    type: 'sale_order' as const,
    error: withMeta({ httpStatus: 503 }),
    expected: true,
  },
  {
    name: 'does not retry a sale rejected for insufficient stock',
    type: 'sale_order' as const,
    error: withMeta({ code: 'insufficient_stock' }),
    expected: false,
  },
  {
    name: 'does not retry a sale rejected with HTTP 422',
    type: 'sale_order' as const,
    error: withMeta({ httpStatus: 422 }),
    expected: false,
  },
  {
    name: 'retries a photo after a network failure',
    type: 'photo' as const,
    error: new Error('Network request failed'),
    expected: true,
  },
  {
    name: 'does not retry a photo after an unknown error',
    type: 'photo' as const,
    error: new Error('unknown'),
    expected: false,
  },
];

for (const testCase of cases) {
  test(testCase.name, () => {
    assert.equal(shouldRetrySyncItemError(testCase.type, testCase.error), testCase.expected);
  });
}
