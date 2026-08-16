import assert from 'node:assert/strict';
import test from 'node:test';

interface DayBundleTransport {
  refreshEmployeeDayBundle: (input: unknown) => Promise<{
    status: 'updated' | 'not_modified';
    record: { etag: string; bundle: { operational_date: string } };
  }>;
  DayBundleTransportError: new (status: number, code: string) => Error & { status: number; code: string };
}

const session = { companyId: 34, employeeId: 42, sessionId: 'non-secret-session-ref' };
const context = { companyId: 34, employeeId: 42, operationalDate: '2026-08-14', nowMs: Date.parse('2026-08-14T12:00:00Z') };

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'day_bundle.v1', operational_date: '2026-08-14', expires_at: '2026-08-15 05:59:59',
    plan: { id: 1, date: '2026-08-14', state: 'published', route_id: 1, vehicle_id: 1 },
    stops: [], catalog: [], directory: [], no_sale_reasons: [], gift_reasons: [], competitors: [],
    ...overrides,
  };
}

function record(etag = '"previous"', currentBundle = bundle()) {
  return { identity: { companyId: 34, employeeId: 42 }, etag, fetched_at_ms: Date.parse('2026-08-14T10:00:00Z'), bundle: currentBundle };
}

async function loadTransport(): Promise<DayBundleTransport> {
  return await import('../src/services/employeeDayBundle.ts') as DayBundleTransport;
}

test('GET 200 replaces the encrypted day-bundle envelope and retains the response ETag', async () => {
  const transport = await loadTransport();
  const saves: unknown[] = [];
  let request: { url: string; init: { method: string; headers: Record<string, string> } } | null = null;

  const result = await transport.refreshEmployeeDayBundle({
    session, context, baseUrl: 'https://example.test/', bearerToken: 'employee-token',
    load: async () => null,
    save: async (_session: unknown, key: string, value: unknown) => { assert.equal(key, 'day-bundle'); saves.push(value); },
    request: async (url: string, init: { method: string; headers: Record<string, string> }) => {
      request = { url, init };
      return { status: 200, headers: { etag: '"next"' }, text: JSON.stringify(bundle()) };
    },
  });

  assert.equal(result.status, 'updated');
  assert.equal(result.record.etag, '"next"');
  assert.equal(saves.length, 1);
  assert.deepEqual(request, {
    url: 'https://example.test/gf/logistics/api/employee/day-bundle',
    init: { method: 'GET', headers: { Authorization: 'Bearer employee-token', Accept: 'application/json' } },
  });
});

test('GET 304 preserves the prior encrypted bundle and sends If-None-Match', async () => {
  const transport = await loadTransport();
  const previous = record();
  let saved = false;
  let headers: Record<string, string> | null = null;

  const result = await transport.refreshEmployeeDayBundle({
    session, context, baseUrl: 'https://example.test', bearerToken: 'employee-token',
    load: async () => previous,
    save: async () => { saved = true; },
    request: async (_url: string, init: { headers: Record<string, string> }) => {
      headers = init.headers;
      return { status: 304, headers: { etag: '"previous"' }, text: '' };
    },
  });

  assert.equal(result.status, 'not_modified');
  assert.equal(result.record.etag, '"previous"');
  assert.equal(saved, false);
  assert.deepEqual(headers, {
    Authorization: 'Bearer employee-token', Accept: 'application/json', 'If-None-Match': '"previous"',
  });
});

test('GET error body and empty 304 without a retained bundle are deterministic errors', async () => {
  const transport = await loadTransport();
  const common = { session, context, baseUrl: 'https://example.test', bearerToken: 'employee-token', load: async () => null, save: async () => {} };

  await assert.rejects(
    () => transport.refreshEmployeeDayBundle({
      ...common,
      request: async () => ({ status: 409, headers: {}, text: JSON.stringify({ ok: false, code: 'ambiguous_active_plan' }) }),
    }),
    (error: unknown) => error instanceof transport.DayBundleTransportError
      && error.status === 409 && error.code === 'ambiguous_active_plan',
  );
  await assert.rejects(
    () => transport.refreshEmployeeDayBundle({
      ...common,
      request: async () => ({ status: 304, headers: {}, text: '' }),
    }),
    /not_modified_without_cache/i,
  );
});

test('a stale retained bundle never becomes a network-error fallback', async () => {
  const transport = await loadTransport();
  const stale = record('"stale"', bundle({ expires_at: '2026-08-14 05:59:59' }));

  await assert.rejects(
    () => transport.refreshEmployeeDayBundle({
      session, context, baseUrl: 'https://example.test', bearerToken: 'employee-token',
      load: async () => stale, save: async () => {},
      request: async () => ({ status: 503, headers: {}, text: JSON.stringify({ ok: false, code: 'service_unavailable' }) }),
    }),
    (error: unknown) => error instanceof transport.DayBundleTransportError
      && error.status === 503 && error.code === 'service_unavailable',
  );
});
