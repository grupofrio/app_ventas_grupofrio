import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeDiagnosticPayloadForTests,
  fingerprintDiagnosticPayload,
} from '../src/services/diagnosticFingerprint.ts';
import {
  describeOperationIntentDiagnostics,
  fingerprintOperationPayload,
} from '../src/services/operationIntentDiagnostics.ts';

test('same nested payload with different key order yields same fingerprint', () => {
  const a = {
    _operationId: 'sale-op-abc',
    partner_id: 501,
    lines: [{ product_id: 7, quantity: 2 }],
    meta: { warehouse_id: 3, pricelist_id: 104 },
  };
  const b = {
    meta: { pricelist_id: 104, warehouse_id: 3 },
    lines: [{ quantity: 2, product_id: 7 }],
    partner_id: 501,
    _operationId: 'sale-op-abc',
  };
  assert.equal(fingerprintDiagnosticPayload(a), fingerprintDiagnosticPayload(b));
  assert.equal(fingerprintOperationPayload(a), fingerprintOperationPayload(b));
});

test('nested semantic field changes yield different fingerprints', () => {
  const base = {
    _operationId: 'sale-op-abc',
    lines: [{ product_id: 7, quantity: 2 }],
  };
  const changed = {
    _operationId: 'sale-op-abc',
    lines: [{ product_id: 7, quantity: 3 }],
  };
  assert.notEqual(fingerprintDiagnosticPayload(base), fingerprintDiagnosticPayload(changed));
});

test('canonicalizer recursively includes nested payload content', () => {
  const canonical = canonicalizeDiagnosticPayloadForTests({
    outer: { inner: { value: 1 }, list: [1, { x: 2 }] },
  });
  assert.match(canonical, /"inner"/);
  assert.match(canonical, /"list"/);
  assert.match(canonical, /"x"/);
});

test('diagnostics mask operation id and never emit full payload', () => {
  const diagnostics = describeOperationIntentDiagnostics({
    operationType: 'sale_order',
    operationId: 'sale-op-abcdef12',
    payload: { _operationId: 'sale-op-abcdef12', secret: 'should-not-appear' },
    recoveryState: 'pending',
    queueState: 'queued',
  });
  assert.match(diagnostics.payload_fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(diagnostics.operation_id_masked.includes('abcdef12'), false);
  assert.equal(JSON.stringify(diagnostics).includes('should-not-appear'), false);
});
