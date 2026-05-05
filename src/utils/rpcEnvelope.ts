/**
 * Functional-error detection for the gf custom Odoo endpoints.
 *
 * Background:
 *   Many custom controllers (gf_logistics_ops, os_api, etc.) ALWAYS return
 *   HTTP 200 even when the operation fails — they wrap the failure inside
 *   the JSON-RPC `result` payload as:
 *
 *     { "result": { "ok": false, "status": 403, "case": -403,
 *                   "error": "Operación no autorizada.", "data": {} } }
 *
 *   `postRpc` historically only looked at `parsed.error.*` (the native
 *   Odoo error channel), so a 403 envelope reached callers as a
 *   plain object. `tryGpsBatchCreate` simply did `await postRpc(...)`
 *   then returned `true`, marking the GPS batch as succeeded even
 *   though the backend rejected it.
 *
 *   This helper centralises the envelope shape so postRpc, postJsonRpc
 *   and any future caller share one truth.
 *
 * Detection rules (any one fires):
 *   - `result.ok === false`     → explicit functional failure flag
 *   - `result.status >= 400`    → mirrored HTTP-style status inside payload
 *   - `result.case <  0`        → legacy negative-case sentinel (os_api)
 *   - `result.error` is a non-empty string AND no positive ok flag
 *
 * Returns the human-readable message to throw, or null if the envelope
 * is healthy. Returning a string keeps the helper pure and testable.
 */

export interface FunctionalErrorContext {
  /** HTTP status reported by the transport layer (used for fallback msg). */
  httpStatus?: number;
}

export function detectFunctionalErrorMessage(
  result: unknown,
  ctx: FunctionalErrorContext = {},
): string | null {
  // Only object envelopes can carry functional errors. Arrays / primitives
  // are healthy /get_records responses, primitive returns from create, etc.
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const r = result as Record<string, unknown>;

  const errStr = typeof r.error === 'string' ? r.error.trim() : '';
  const msgStr = typeof r.message === 'string' ? r.message.trim() : '';
  const status = typeof r.status === 'number' ? r.status : undefined;
  const caseCode = typeof r.case === 'number' ? r.case : undefined;
  const ok = r.ok;

  // Explicit ok:false → functional failure regardless of status.
  if (ok === false) {
    return errStr || msgStr || `HTTP ${status ?? ctx.httpStatus ?? 0}`;
  }

  // Mirrored HTTP-style failure status inside payload.
  if (typeof status === 'number' && status >= 400) {
    return errStr || msgStr || `HTTP ${status}`;
  }

  // Legacy negative-case sentinel from os_api.
  if (typeof caseCode === 'number' && caseCode < 0) {
    return errStr || msgStr || `Case ${caseCode}`;
  }

  // `error` field present without ok:true — treat as failure.
  // (Healthy envelopes with `ok:true` would have triggered the early
  // ok-not-false branch and reached here only when ok is undefined; in
  // that case a non-empty error string is conclusive.)
  if (errStr && ok !== true) {
    return errStr;
  }

  return null;
}
