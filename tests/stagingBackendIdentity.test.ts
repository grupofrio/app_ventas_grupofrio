import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStagingBackendIdentity,
  type StagingBackendFetch,
} from '../src/services/stagingBackendIdentity.ts';

const STAGING_URL = 'https://odoo-staging.grupofrio.com';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('resolves the active DB from the configured staging host', async () => {
  const fetcher: StagingBackendFetch = async (url) => {
    assert.equal(url, `${STAGING_URL}/current_database`);
    return jsonResponse(200, { db: 'grupofrio-gf-staging280826-37235488' });
  };

  assert.deepEqual(
    await resolveStagingBackendIdentity({
      baseUrl: STAGING_URL,
      expectedBaseUrl: STAGING_URL,
      fetcher,
    }),
    {
      status: 'verified',
      baseUrl: STAGING_URL,
      host: 'odoo-staging.grupofrio.com',
      db: 'grupofrio-gf-staging280826-37235488',
      reason: null,
    },
  );
});

test('rejects a host that does not match staging without making a request', async () => {
  let calls = 0;

  const identity = await resolveStagingBackendIdentity({
    baseUrl: 'https://grupofrio-gf.odoo.com',
    expectedBaseUrl: STAGING_URL,
    fetcher: async () => {
      calls += 1;
      return jsonResponse(200, { db: 'production-db' });
    },
  });

  assert.equal(calls, 0);
  assert.equal(identity.status, 'unverified');
  assert.equal(identity.reason, 'host_not_allowed');
});

test('does not verify unavailable, invalid, or failed backend responses', async () => {
  const cases: Array<{
    response?: Response;
    expectedReason: string;
  }> = [
    {
      response: jsonResponse(503, { error: { code: 'DATABASE_UNAVAILABLE' } }),
      expectedReason: 'database_unavailable',
    },
    {
      response: jsonResponse(500, { error: { code: 'INTERNAL_ERROR' } }),
      expectedReason: 'server_error',
    },
    {
      response: jsonResponse(200, {}),
      expectedReason: 'invalid_response',
    },
  ];

  for (const testCase of cases) {
    const identity = await resolveStagingBackendIdentity({
      baseUrl: `${STAGING_URL}/`,
      expectedBaseUrl: STAGING_URL,
      fetcher: async () => testCase.response as Response,
    });

    assert.equal(identity.status, 'unverified');
    assert.equal(identity.baseUrl, STAGING_URL);
    assert.equal(identity.reason, testCase.expectedReason);
  }

  const networkIdentity = await resolveStagingBackendIdentity({
    baseUrl: STAGING_URL,
    expectedBaseUrl: STAGING_URL,
    fetcher: async () => {
      throw new Error('offline');
    },
  });

  assert.equal(networkIdentity.status, 'unverified');
  assert.equal(networkIdentity.reason, 'network_error');
});

test('explicit staging test mode uses only the approved pinned host and DB without discovery', async () => {
  let calls = 0;
  const identity = await resolveStagingBackendIdentity({
    baseUrl: 'https://odoo-staging.grupofrio.mx', expectedBaseUrl: 'https://odoo-staging.grupofrio.mx',
    useConfiguredDatabase: true, configuredDatabase: 'grupofrio-gf-staging280826-37235488',
    fetcher: async () => { calls++; throw new Error('HTTP 500'); },
  });
  assert.equal(identity.status, 'configured');
  assert.equal(identity.db, 'grupofrio-gf-staging280826-37235488');
  assert.equal(calls, 0);
});

test('configured test mode rejects production, different DB and insecure URL', async () => {
  for (const [url,db] of [
    ['https://grupofrio-gf.odoo.com','grupofrio-gf-main-34980678'],
    ['https://odoo-staging.grupofrio.mx','grupofrio-gf-main-34980678'],
    ['http://odoo-staging.grupofrio.mx','grupofrio-gf-staging280826-37235488'],
  ]) {
    let calls=0;
    const identity=await resolveStagingBackendIdentity({baseUrl:url,expectedBaseUrl:url,useConfiguredDatabase:true,configuredDatabase:db,
      fetcher:async()=>{calls++;return jsonResponse(200,{db});}});
    assert.equal(identity.status,'unverified');assert.equal(calls,0);
  }
});
