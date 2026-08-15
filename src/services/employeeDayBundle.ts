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
    // Validate before using a stored ETag: another account/day must never
    // influence conditional request state for this session.
    const validatedPrior = replaceDayBundleAtomically(prior, input.context);
    headers['If-None-Match'] = validatedPrior.etag;
  }

  const response = await input.request(`${normalizedBaseUrl(input.baseUrl)}${DAY_BUNDLE_PATH}`, {
    method: 'GET', headers,
  });

  if (response.status === 304) {
    if (prior === null) throw new DayBundleTransportError(304, 'not_modified_without_cache');
    const record = replaceDayBundleAtomically(prior, input.context);
    // An expired bundle is intentionally returned read-only; we never issue a
    // second request that would turn it into a hidden network fallback.
    evaluateStoredDayBundle(record, input.context);
    return { status: 'not_modified', record };
  }

  if (response.status !== 200) {
    throw new DayBundleTransportError(response.status, parseErrorCode(response.text));
  }

  const etag = responseHeader(response.headers, 'etag');
  if (!etag?.trim()) throw new DayBundleTransportError(200, 'missing_day_bundle_etag');
  const record = replaceDayBundleAtomically({
    identity: { companyId: input.session.companyId, employeeId: input.session.employeeId },
    etag,
    fetched_at_ms: input.context.nowMs,
    bundle: parseBundle(response.text),
  }, input.context);
  await input.save(input.session, DAY_BUNDLE_RECORD_KEY, record);
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
  if (!session) throw new Error('La sesión cifrada del bundle no está disponible.');
  const bearerToken = await api.getEmployeeBearerToken();
  if (!bearerToken) throw new Error('La sesión de empleado no está disponible.');
  const baseUrl = await api.getBaseUrl();
  const context = currentContext(session, nowMs);
  return refreshEmployeeDayBundle({
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
}

export async function loadCurrentEmployeeDayBundle(
  nowMs = Date.now(),
): Promise<{ record: StoredDayBundle; access: ReturnType<typeof evaluateStoredDayBundle> } | null> {
  const [{ getFieldDataSession }, { loadEncrypted }] = await Promise.all([
    import('./fieldDataSession.ts'),
    import('./encryptedStore.ts'),
  ]);
  const session = await getFieldDataSession();
  if (!session) return null;
  const record = await loadEncrypted<StoredDayBundle>(session, DAY_BUNDLE_RECORD_KEY);
  if (!record) return null;
  const context = currentContext(session, nowMs);
  return { record: replaceDayBundleAtomically(record, context), access: evaluateStoredDayBundle(record, context) };
}
