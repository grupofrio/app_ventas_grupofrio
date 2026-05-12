import assert from 'node:assert/strict';

interface OdooDatabaseModule {
  candidateOdooDatabases: (baseUrl: string, configuredDb?: string | null, listedDbs?: string[]) => string[];
  extractOdooDatabaseNames: (payload: unknown) => string[];
  resolveOdooDatabase: (
    baseUrl: string,
    configuredDb?: string | null,
    fetcher?: (baseUrl: string) => Promise<string[]>,
  ) => Promise<string | null>;
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/odooDatabase.ts', import.meta.url).pathname
  ) as OdooDatabaseModule;

  assert.deepEqual(
    module.candidateOdooDatabases(
      'https://grupofrio.odoo.com',
      'grupofrio-grupofrio-20239580',
      ['grupofrio-grupofrio-31972140'],
    ),
    ['grupofrio-grupofrio-20239580', 'grupofrio-grupofrio-31972140', 'grupofrio'],
  );

  assert.deepEqual(
    module.candidateOdooDatabases('https://grupofrio.odoo.com', 'grupofrio'),
    ['grupofrio'],
  );

  assert.deepEqual(
    module.candidateOdooDatabases('https://example.test', null),
    [],
  );

  assert.deepEqual(
    module.extractOdooDatabaseNames({
      id: null,
      jsonrpc: '2.0',
      result: ['grupofrio-grupofrio-31972140'],
    }),
    ['grupofrio-grupofrio-31972140'],
  );

  assert.equal(
    await module.resolveOdooDatabase(
      'https://grupofrio.odoo.com',
      'grupofrio-grupofrio-20239580',
      async () => ['grupofrio-grupofrio-31972140'],
    ),
    'grupofrio-grupofrio-31972140',
  );

  assert.equal(
    await module.resolveOdooDatabase(
      'https://grupofrio.odoo.com',
      null,
      async () => [],
    ),
    'grupofrio',
  );

  console.log('odoo database tests: ok');
}

void main();
