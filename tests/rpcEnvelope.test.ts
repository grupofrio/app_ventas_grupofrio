/**
 * Tests for detectFunctionalErrorMessage — the helper that catches
 * gf custom-controller error envelopes that arrive over HTTP 200.
 *
 * Real-world failure that drove this fix:
 *   POST /api/create_update (model: os.employee.gps.history,
 *                            method: batch_create)
 *   → HTTP 200
 *   → { jsonrpc:"2.0",
 *       result: { ok:false, status:403, case:-403,
 *                 error:"Operación no autorizada.", data:{} } }
 *   Before: postRpc returned the result object, tryGpsBatchCreate
 *           returned true, items marked done. Silent data loss /
 *           false telemetry success.
 *   After:  postRpc throws "Operación no autorizada.", batch handler
 *           marks items dead with explicit unauthorized log.
 */

import assert from 'node:assert/strict';

interface RpcEnvelopeModule {
  detectFunctionalErrorMessage: (
    result: unknown,
    ctx?: { httpStatus?: number },
  ) => string | null;
}

interface SyncFailureModule {
  isRetryableSyncErrorMessage: (m: string | null | undefined) => boolean;
}

function testDetectsGpsBatch403(m: RpcEnvelopeModule) {
  const result = {
    case: -403,
    data: {},
    error: 'Operación no autorizada.',
    ok: false,
    status: 403,
  };
  assert.equal(m.detectFunctionalErrorMessage(result, { httpStatus: 200 }), 'Operación no autorizada.');
}

function testDetectsOkFalseEvenWithoutStatus(m: RpcEnvelopeModule) {
  const result = { ok: false, error: 'Bad payload' };
  assert.equal(m.detectFunctionalErrorMessage(result), 'Bad payload');
}

function testDetectsStatus4xxWithoutOkFlag(m: RpcEnvelopeModule) {
  const result = { status: 422, error: 'Validation failed' };
  assert.equal(m.detectFunctionalErrorMessage(result), 'Validation failed');
}

function testDetectsNegativeCase(m: RpcEnvelopeModule) {
  const result = { case: -3, error: 'ACL denied' };
  assert.equal(m.detectFunctionalErrorMessage(result), 'ACL denied');
}

function testFallsBackToHttpStatusWhenErrorMissing(m: RpcEnvelopeModule) {
  const result = { ok: false, status: 500 };
  assert.equal(m.detectFunctionalErrorMessage(result, { httpStatus: 200 }), 'HTTP 500');
}

function testHealthyEnvelopesReturnNull(m: RpcEnvelopeModule) {
  // Healthy create response (primitive id)
  assert.equal(m.detectFunctionalErrorMessage(123), null);
  // Healthy /get_records (array)
  assert.equal(m.detectFunctionalErrorMessage([{ id: 1 }, { id: 2 }]), null);
  // Healthy wrapped response { response: [...] }
  assert.equal(m.detectFunctionalErrorMessage({ response: [], status: 200 }), null);
  // Explicit ok:true is healthy
  assert.equal(m.detectFunctionalErrorMessage({ ok: true, data: {} }), null);
  // Null / undefined / boolean
  assert.equal(m.detectFunctionalErrorMessage(null), null);
  assert.equal(m.detectFunctionalErrorMessage(undefined), null);
  assert.equal(m.detectFunctionalErrorMessage(true), null);
}

function testDoesNotFlagPositiveCase(m: RpcEnvelopeModule) {
  // os_api uses positive case codes for success markers (e.g. case=1 → ok)
  assert.equal(m.detectFunctionalErrorMessage({ case: 1, data: {} }), null);
  assert.equal(m.detectFunctionalErrorMessage({ case: 0, data: {} }), null);
}

function testDoesNotFlagStatus3xxOr2xx(m: RpcEnvelopeModule) {
  assert.equal(m.detectFunctionalErrorMessage({ status: 200 }), null);
  assert.equal(m.detectFunctionalErrorMessage({ status: 304 }), null);
}

function testErrorFieldOnlyTriggersWhenOkUndefined(m: RpcEnvelopeModule) {
  // Some endpoints return { ok:true, data:{...}, error:"" } — empty
  // error string with ok:true is healthy.
  assert.equal(m.detectFunctionalErrorMessage({ ok: true, error: '' }), null);
  // Missing ok + non-empty error → still failure (defensive)
  assert.equal(m.detectFunctionalErrorMessage({ error: 'Something broke' }), 'Something broke');
}

function testUnauthorizedMessageIsNotRetryable(s: SyncFailureModule) {
  // Confirms the existing retry policy treats 403 as terminal so the
  // GPS handler (handleGpsItemError) marks dead immediately.
  assert.equal(s.isRetryableSyncErrorMessage('Operación no autorizada.'), false);
  assert.equal(s.isRetryableSyncErrorMessage('HTTP 403'), false);
  assert.equal(s.isRetryableSyncErrorMessage('Forbidden'), false);
  // And confirms transient errors are still retryable.
  assert.equal(s.isRetryableSyncErrorMessage('Network request failed'), true);
  assert.equal(s.isRetryableSyncErrorMessage('HTTP 503'), true);
}

async function main() {
  const env = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/utils/rpcEnvelope.ts', import.meta.url).pathname
  ) as RpcEnvelopeModule;
  const sync = await import(
    // @ts-ignore
    new URL('../src/utils/syncFailure.ts', import.meta.url).pathname
  ) as SyncFailureModule;

  testDetectsGpsBatch403(env);
  testDetectsOkFalseEvenWithoutStatus(env);
  testDetectsStatus4xxWithoutOkFlag(env);
  testDetectsNegativeCase(env);
  testFallsBackToHttpStatusWhenErrorMissing(env);
  testHealthyEnvelopesReturnNull(env);
  testDoesNotFlagPositiveCase(env);
  testDoesNotFlagStatus3xxOr2xx(env);
  testErrorFieldOnlyTriggersWhenOkUndefined(env);
  testUnauthorizedMessageIsNotRetryable(sync);

  console.log('rpc envelope detection tests: ok');
}

void main();
