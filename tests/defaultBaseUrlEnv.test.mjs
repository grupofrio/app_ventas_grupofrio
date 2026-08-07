import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /EXPO_PUBLIC_KF_DEFAULT_BASE_URL/,
  'api.ts must read EXPO_PUBLIC_KF_DEFAULT_BASE_URL for staging/device smoke builds',
);

assert.match(
  source,
  /export const DEFAULT_BASE_URL\s*=\s*PUBLIC_DEFAULT_BASE_URL\s*\|\|\s*'https:\/\/grupofrio-gf\.odoo\.com'/,
  'DEFAULT_BASE_URL must fall back to production (grupofrio-gf) only when the public env var is absent',
);

const databaseSource = readFileSync(
  new URL('../src/services/odooDatabase.ts', import.meta.url),
  'utf8',
);

assert.match(
  databaseSource,
  /EXPO_PUBLIC_KF_ODOO_DB/,
  'odooDatabase.ts must read EXPO_PUBLIC_KF_ODOO_DB for staging/device smoke builds',
);

assert.match(
  databaseSource,
  /export const DEFAULT_ODOO_DB\s*=\s*PUBLIC_DEFAULT_ODOO_DB\s*\|\|\s*'grupofrio-gf-main-34980678'/,
  'DEFAULT_ODOO_DB must fall back to the production database only when the public env var is absent',
);

console.log('default base url env tests: ok');
