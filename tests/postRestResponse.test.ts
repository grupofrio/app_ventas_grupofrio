import assert from 'node:assert/strict';
import test from 'node:test';

import { readPostRestResponseText } from '../src/services/postRestResponse.ts';
import { classifySaleSubmissionError } from '../src/services/saleSubmissionOutcome.ts';

test('a 200 response whose body cannot be read is an ambiguous invalid response', async () => {
  const bodyFailure = Object.assign(new Error('response stream disconnected'), {
    code: 'api_rejection',
  });
  const response = {
    status: 200,
    ok: true,
    text: async () => { throw bodyFailure; },
  };

  await assert.rejects(
    readPostRestResponseText(response),
    (error: unknown) => {
      assert.equal((error as { httpStatus?: number }).httpStatus, 200);
      assert.equal((error as { responseReceived?: boolean }).responseReceived, true);
      assert.equal((error as { code?: string }).code, 'invalid_response');
      assert.equal(classifySaleSubmissionError(error).kind, 'ambiguous_result');
      return true;
    },
  );
});
