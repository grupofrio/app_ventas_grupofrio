import assert from 'node:assert/strict';

interface OdooDatabaseModule {
  DEFAULT_ODOO_DB: string;
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

  assert.equal(module.DEFAULT_ODOO_DB, 'grupofrio-gf-main-34980678');

  assert.deepEqual(
    module.candidateOdooDatabases(
      'https://grupofrio-gf.odoo.com',
      'grupofrio-gf-configured',
      ['grupofrio-gf-main-34980678'],
    ),
    ['grupofrio-gf-configured', 'grupofrio-gf-main-34980678', 'grupofrio-gf'],
  );

  // Sin lista del servidor ni DB configurada: el default determinista va antes
  // que el subdominio (que no es un nombre de DB válido en Odoo.sh).
  assert.deepEqual(
    module.candidateOdooDatabases('https://grupofrio-gf.odoo.com', null),
    ['grupofrio-gf-main-34980678', 'grupofrio-gf'],
  );

  assert.deepEqual(
    module.candidateOdooDatabases('https://example.test', null),
    ['grupofrio-gf-main-34980678'],
  );

  assert.deepEqual(
    module.extractOdooDatabaseNames({
      id: null,
      jsonrpc: '2.0',
      result: ['grupofrio-gf-main-34980678'],
    }),
    ['grupofrio-gf-main-34980678'],
  );

  // La lista del servidor sigue ganando: sobrevive renombres de DB en Odoo.sh
  // sin recompilar el APK.
  assert.equal(
    await module.resolveOdooDatabase(
      'https://grupofrio-gf.odoo.com',
      'grupofrio-gf-configured',
      async () => ['grupofrio-gf-renamed-99999999'],
    ),
    'grupofrio-gf-renamed-99999999',
  );

  // list_db deshabilitado (lista vacía): resolución determinista al default,
  // no al subdominio.
  assert.equal(
    await module.resolveOdooDatabase(
      'https://grupofrio-gf.odoo.com',
      null,
      async () => [],
    ),
    'grupofrio-gf-main-34980678',
  );

  // Una DB explícita del caller conserva la máxima prioridad en el fallback.
  assert.equal(
    await module.resolveOdooDatabase(
      'https://grupofrio-gf.odoo.com',
      'grupofrio-gf-configured',
      async () => [],
    ),
    'grupofrio-gf-configured',
  );

  console.log('odoo database tests: ok');
}

void main();
