/**
 * Cache-aware HTTP transport for the employee day bundle.
 *
 * Dependencies are passed in so the protocol stays testable without a native
 * module. The production adapter will provide the encrypted session store;
 * this module never reads or writes plaintext persistence.
 */

import {
  evaluateStoredDayBundle,
  replaceDayBundleAtomically,
  type DayBundleContext,
  type StoredDayBundle,
} from './employeeDayBundleLogic.ts';
import type { EncryptedSessionIdentity } from './encryptedStore.ts';

// TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation.
// Uses console directly (not src/utils/logger.ts) because logger.ts has a
// transitive import without a file extension that node --experimental-strip-types
// cannot resolve, which broke tests/employeeDayBundleTransport.test.ts.
function diagLog(event: string, data: Record<string, unknown>): void {
  console.log(`[DIAG day-bundle] ${event}`, data);
}
function diagWarn(event: string, data: Record<string, unknown>): void {
  console.warn(`[DIAG day-bundle] ${event}`, data);
}

const DAY_BUNDLE_PATH = '/gf/logistics/api/employee/day-bundle';
const DAY_BUNDLE_RECORD_KEY = 'day-bundle';

interface HttpResponse {
  status: number;
  headers: Headers | Record<string, string | undefined>;
  text: string;
}

export interface RefreshEmployeeDayBundleInput {
  session: EncryptedSessionIdentity;
  context: DayBundleContext;
  baseUrl: string;
  bearerToken: string;
  load: (session: EncryptedSessionIdentity, key: typeof DAY_BUNDLE_RECORD_KEY) => Promise<unknown | null>;
  save: (session: EncryptedSessionIdentity, key: typeof DAY_BUNDLE_RECORD_KEY, value: StoredDayBundle) => Promise<void>;
  request: (url: string, init: { method: 'GET'; headers: Record<string, string> }) => Promise<HttpResponse>;
}

export class DayBundleTransportError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Day bundle request failed: ${code}`);
    this.name = 'DayBundleTransportError';
    this.status = status;
    this.code = code;
  }
}

function responseHeader(headers: HttpResponse['headers'], name: string): string | null {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected && typeof value === 'string') return value;
  }
  return null;
}

function normalizedBaseUrl(value: string): string {
  const baseUrl = value.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Day bundle base URL is required.');
  return baseUrl;
}

function parseErrorCode(text: string): string {
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      const code = (body as Record<string, unknown>).code;
      if (typeof code === 'string' && code.trim()) return code;
    }
  } catch {
    // Non-JSON failure bodies remain deterministic by status below.
  }
  return 'day_bundle_request_failed';
}

function parseBundle(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DayBundleTransportError(200, 'invalid_day_bundle_body');
  }
}

export async function refreshEmployeeDayBundle(
  input: RefreshEmployeeDayBundleInput,
): Promise<{ status: 'updated' | 'not_modified'; record: StoredDayBundle }> {
  const prior = await input.load(input.session, DAY_BUNDLE_RECORD_KEY);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.bearerToken.trim()}`,
    Accept: 'application/json',
  };
  if (prior !== null) {
    // Validate before using a stored ETag: another account must never
    // influence conditional request state. Soft-date: device midnight must
    // not wipe a still-valid lease before expires_at.
    const validatedPrior = replaceDayBundleAtomically(prior, input.context, {
      requireOperationalDateMatch: false,
    });
    headers['If-None-Match'] = validatedPrior.etag;
  }

  const response = await input.request(`${normalizedBaseUrl(input.baseUrl)}${DAY_BUNDLE_PATH}`, {
    method: 'GET', headers,
  });

  if (response.status === 304) {
    if (prior === null) throw new DayBundleTransportError(304, 'not_modified_without_cache');
    const record = replaceDayBundleAtomically(prior, input.context, {
      requireOperationalDateMatch: false,
    });
    // An expired bundle is intentionally returned read-only; we never issue a
    // second request that would turn it into a hidden network fallback.
    evaluateStoredDayBundle(record, input.context);
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagLog('refresh_result', {
      httpStatus: 304,
      persisted: false,
      operationalDate: record.bundle.operational_date,
      expiresAt: record.bundle.expires_at,
    });
    return { status: 'not_modified', record };
  }

  if (response.status !== 200) {
    const code = parseErrorCode(response.text);
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagWarn('refresh_error', { httpStatus: response.status, code });
    throw new DayBundleTransportError(response.status, code);
  }

  const etag = responseHeader(response.headers, 'etag');
  if (!etag?.trim()) throw new DayBundleTransportError(200, 'missing_day_bundle_etag');
  // New server bodies must match the requested operational day.
  const record = replaceDayBundleAtomically({
    identity: { companyId: input.session.companyId, employeeId: input.session.employeeId },
    etag,
    fetched_at_ms: input.context.nowMs,
    bundle: parseBundle(response.text),
  }, input.context);
  await input.save(input.session, DAY_BUNDLE_RECORD_KEY, record);
  // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
  diagLog('refresh_result', {
    httpStatus: 200,
    persisted: true,
    operationalDate: record.bundle.operational_date,
    expiresAt: record.bundle.expires_at,
  });
  return { status: 'updated', record };
}

export { DAY_BUNDLE_RECORD_KEY };

export function localOperationalDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentContext(session: EncryptedSessionIdentity, nowMs: number): DayBundleContext {
  return {
    companyId: session.companyId,
    employeeId: session.employeeId,
    operationalDate: localOperationalDate(new Date(nowMs)),
    nowMs,
  };
}

/**
 * Production encrypted-envelope adapter. A bundle is never read from
 * AsyncStorage, and a failed refresh deliberately does not return a stale
 * record as though the network request had succeeded.
 */
export async function prepareCurrentEmployeeDayBundle(
  nowMs = Date.now(),
): Promise<{ status: 'updated' | 'not_modified'; record: StoredDayBundle }> {
  const [{ getFieldDataSession }, { loadEncrypted, saveEncrypted }, api] = await Promise.all([
    import('./fieldDataSession.ts'),
    import('./encryptedStore.ts'),
    import('./api.ts'),
  ]);
  const session = await getFieldDataSession();
  if (!session) {
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagWarn('prepare_error', { reason: 'no_encrypted_session' });
    throw new Error('La sesión cifrada del bundle no está disponible.');
  }
  const bearerToken = await api.getEmployeeBearerToken();
  if (!bearerToken) {
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagWarn('prepare_error', { reason: 'no_bearer_token' });
    throw new Error('La sesión de empleado no está disponible.');
  }
  const baseUrl = await api.getBaseUrl();
  const context = currentContext(session, nowMs);
  // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
  diagLog('prepare_start', {
    operationalDate: context.operationalDate,
    nowMs,
  });
  try {
    return await refreshEmployeeDayBundle({
      session,
      context,
      baseUrl,
      bearerToken,
      load: loadEncrypted,
      save: saveEncrypted,
      request: async (url, init) => {
        const response = await api.fetchWithTimeout(url, init, api.DEFAULT_READ_TIMEOUT_MS);
        return { status: response.status, headers: response.headers, text: await response.text() };
      },
    });
  } catch (error) {
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagWarn('prepare_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function loadCurrentEmployeeDayBundle(
  nowMs = Date.now(),
): Promise<{ record: StoredDayBundle; access: ReturnType<typeof evaluateStoredDayBundle> } | null> {
  const [{ getFieldDataSession }, { loadEncrypted }] = await Promise.all([
    import('./fieldDataSession.ts'),
    import('./encryptedStore.ts'),
  ]);
  const session = await getFieldDataSession();
  if (!session) {
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagLog('load', { found: false, reason: 'no_encrypted_session' });
    return null;
  }
  const record = await loadEncrypted<StoredDayBundle>(session, DAY_BUNDLE_RECORD_KEY);
  if (!record) {
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagLog('load', { found: false, reason: 'no_stored_record' });
    return null;
  }
  const context = currentContext(session, nowMs);
  try {
    const validated = replaceDayBundleAtomically(record, context, { requireOperationalDateMatch: false });
    const access = evaluateStoredDayBundle(record, context);
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagLog('load', {
      found: true,
      operationalDate: validated.bundle.operational_date,
      expiresAt: validated.bundle.expires_at,
      nowMs,
      accessMode: access.mode,
      canRead: access.canRead,
      canRunActions: access.canRunActions,
      canStartRoute: access.canStartRoute,
    });
    return { record: validated, access };
  } catch (error) {
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagWarn('load_invalid', {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Session-handoff transfer (Fase Capa 1 — see docs/investigation for
 * "Bundle vencido" root cause). A same-principal reauthentication rotates
 * `sessionId`, which changes the encrypted storage key (see
 * encryptedStoreLogic.ts). Without this explicit copy, a still-valid day
 * bundle becomes invisible under the new session and every mutation gate
 * fails closed with a misleading "vencido" message even though the record
 * was never actually stale — it simply never existed under the new key.
 *
 * This performs a plain copy: it does not renew, refresh, or extend
 * `expires_at`, and it never marks a stale bundle as fresh. A corrupted
 * record or one belonging to a different identity is never copied forward —
 * this is intentionally a no-op in that case rather than a thrown error, so a
 * bad local cache can never block reauthentication.
 */
export async function applyEmployeeDayBundleReauthTransfer(input: {
  previousSession: EncryptedSessionIdentity;
  nextSession: EncryptedSessionIdentity;
  nowMs: number;
  load: (session: EncryptedSessionIdentity, key: typeof DAY_BUNDLE_RECORD_KEY) => Promise<unknown | null>;
  save: (session: EncryptedSessionIdentity, key: typeof DAY_BUNDLE_RECORD_KEY, value: StoredDayBundle) => Promise<void>;
}): Promise<{ transferred: boolean }> {
  const { previousSession, nextSession, nowMs, load, save } = input;
  if (
    previousSession.companyId !== nextSession.companyId
    || previousSession.employeeId !== nextSession.employeeId
    || previousSession.sessionId === nextSession.sessionId
  ) {
    // Not a same-principal session rotation — never transfer across a real
    // account switch, and a no-op sessionId change has nothing to move.
    return { transferred: false };
  }

  const raw = await load(previousSession, DAY_BUNDLE_RECORD_KEY);
  if (raw === null) {
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagLog('reauth_transfer', { transferred: false, reason: 'no_stored_record' });
    return { transferred: false };
  }

  let validated: StoredDayBundle;
  try {
    // Validates schema + identity and clones the record unchanged — etag,
    // fetched_at_ms, and bundle.expires_at all pass through as-is. Staleness
    // is intentionally not evaluated here: this only moves the record, it
    // never decides whether it is still usable.
    validated = replaceDayBundleAtomically(raw, {
      companyId: nextSession.companyId,
      employeeId: nextSession.employeeId,
      operationalDate: localOperationalDate(new Date(nowMs)),
      nowMs,
    }, { requireOperationalDateMatch: false });
  } catch (error) {
    // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
    diagWarn('reauth_transfer', {
      transferred: false,
      reason: 'invalid_source_record',
      message: error instanceof Error ? error.message : String(error),
    });
    return { transferred: false };
  }

  await save(nextSession, DAY_BUNDLE_RECORD_KEY, validated);
  // TEMP DIAGNOSTIC LOG (fix/daily-bundle-validation) — remove after investigation
  diagLog('reauth_transfer', {
    transferred: true,
    operationalDate: validated.bundle.operational_date,
    expiresAt: validated.bundle.expires_at,
  });
  return { transferred: true };
}

/** Production adapter for the encrypted envelope — see applyEmployeeDayBundleReauthTransfer. */
export async function transferEmployeeDayBundleForReauthentication(
  previousSession: EncryptedSessionIdentity,
  nextSession: EncryptedSessionIdentity,
  nowMs = Date.now(),
): Promise<{ transferred: boolean }> {
  const { loadEncrypted, saveEncrypted } = await import('./encryptedStore.ts');
  return applyEmployeeDayBundleReauthTransfer({
    previousSession,
    nextSession,
    nowMs,
    load: loadEncrypted,
    save: saveEncrypted,
  });
}
