/**
 * Safe diagnostics for commercial operation replay — never logs full payloads
 * or credentials. Used when an idempotency conflict cannot yet be reproduced
 * in CI to guide the next field capture.
 */

import { fingerprintDiagnosticPayload } from './diagnosticFingerprint.ts';

export interface OperationIntentDiagnosticsInput {
  operationType: string;
  operationId: string;
  payload: Record<string, unknown>;
  recoveryState: string;
  queueState: string;
  reconcileOutcome?: string;
}

export function fingerprintOperationPayload(payload: Record<string, unknown>): string {
  return fingerprintDiagnosticPayload(payload);
}

export function maskOperationId(operationId: string): string {
  const trimmed = operationId.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

export function describeOperationIntentDiagnostics(
  input: OperationIntentDiagnosticsInput,
): Record<string, string> {
  return {
    operation_type: input.operationType,
    operation_id_masked: maskOperationId(input.operationId),
    payload_fingerprint: fingerprintOperationPayload(input.payload),
    recovery_state: input.recoveryState,
    queue_state: input.queueState,
    reconcile_outcome: input.reconcileOutcome ?? 'unknown',
  };
}

export const OPERATION_ID_FIELD_CAPTURE_INSTRUCTIONS = [
  'Reproduce with airplane mode off after an ambiguous sale submit.',
  'Before tapping retry, export sync queue item payload fingerprint from logs.',
  'Capture operation_type, masked operation_id, recovery_state, queue_state.',
  'If 409 idempotency_conflict appears, record payload_fingerprint before and after any route refresh.',
  'Never paste bearer tokens, cookies, or full customer financial payloads.',
].join(' ');
