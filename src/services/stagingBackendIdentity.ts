export type StagingIdentityReason =
  | 'host_not_allowed'
  | 'network_error'
  | 'database_unavailable'
  | 'server_error'
  | 'invalid_response';

export type StagingBackendIdentity = {
  status: 'verified' | 'configured' | 'unverified';
  baseUrl: string;
  host: string | null;
  db: string | null;
  reason: StagingIdentityReason | null;
};

export type StagingBackendFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function unverifiedIdentity(
  baseUrl: string,
  host: string | null,
  reason: StagingIdentityReason,
): StagingBackendIdentity {
  return {
    status: 'unverified',
    baseUrl,
    host,
    db: null,
    reason,
  };
}

const APPROVED_TEST_URL = 'https://odoo-staging.grupofrio.mx';
const APPROVED_TEST_DB = 'grupofrio-gf-staging280826-37235488';

export function isStagingIdentityAllowed(identity: StagingBackendIdentity): boolean {
  return identity.status === 'verified' || (identity.status === 'configured'
    && identity.baseUrl === APPROVED_TEST_URL && identity.db === APPROVED_TEST_DB);
}

export async function resolveStagingBackendIdentity({
  baseUrl,
  expectedBaseUrl,
  fetcher = fetch,
  useConfiguredDatabase = false,
  configuredDatabase,
}: {
  baseUrl: string;
  expectedBaseUrl: string;
  fetcher?: StagingBackendFetch;
  useConfiguredDatabase?: boolean;
  configuredDatabase?: string;
}): Promise<StagingBackendIdentity> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedExpectedBaseUrl = normalizeBaseUrl(expectedBaseUrl);
  let host: string | null = null;

  try {
    host = new URL(normalizedBaseUrl).hostname;
    const expectedHost = new URL(normalizedExpectedBaseUrl).hostname;
    if (host !== expectedHost) {
      return unverifiedIdentity(normalizedBaseUrl, host, 'host_not_allowed');
    }
  } catch {
    return unverifiedIdentity(normalizedBaseUrl, null, 'host_not_allowed');
  }

  // Explicit temporary QA mode: configuration is pinned, not server-verified.
  if (useConfiguredDatabase) {
    if (normalizedBaseUrl !== APPROVED_TEST_URL || normalizedExpectedBaseUrl !== APPROVED_TEST_URL
      || configuredDatabase !== APPROVED_TEST_DB) {
      return unverifiedIdentity(normalizedBaseUrl, host, 'host_not_allowed');
    }
    return { status: 'configured', baseUrl: normalizedBaseUrl, host, db: configuredDatabase, reason: null };
  }

  try {
    const response = await fetcher(`${normalizedBaseUrl}/current_database`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (response.status === 503) {
      return unverifiedIdentity(normalizedBaseUrl, host, 'database_unavailable');
    }
    if (!response.ok) {
      return unverifiedIdentity(normalizedBaseUrl, host, 'server_error');
    }

    const payload = await response.json() as { db?: unknown };
    const db = typeof payload.db === 'string' ? payload.db.trim() : '';
    if (!db) {
      return unverifiedIdentity(normalizedBaseUrl, host, 'invalid_response');
    }

    return {
      status: 'verified',
      baseUrl: normalizedBaseUrl,
      host,
      db,
      reason: null,
    };
  } catch {
    return unverifiedIdentity(normalizedBaseUrl, host, 'network_error');
  }
}
