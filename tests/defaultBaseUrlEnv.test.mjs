import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const easConfig = JSON.parse(
  readFileSync(new URL('../eas.json', import.meta.url), 'utf8'),
);

const productionApk = easConfig.build['production-apk'];
assert.ok(productionApk, 'production-apk profile must exist for direct Android distribution');
assert.equal(productionApk.distribution, 'internal');
assert.equal(productionApk.android?.buildType, 'apk');
assert.deepEqual(productionApk.env, {
  EXPO_PUBLIC_BUILD_PROFILE: 'production-apk',
  EXPO_PUBLIC_KF_DEFAULT_BASE_URL: 'https://grupofrio-gf.odoo.com',
  EXPO_PUBLIC_KF_ODOO_DB: 'grupofrio-gf-main-34980678',
});

const qaKold114 = easConfig.build['qa-kold114'];
assert.ok(qaKold114, 'qa-kold114 profile must exist for the isolated PR #114 E2E');
assert.equal(qaKold114.distribution, 'internal');
assert.equal(qaKold114.android?.buildType, 'apk');
assert.deepEqual(qaKold114.env, {
  KF_LOCAL_DEV: '1',
  EXPO_PUBLIC_BUILD_PROFILE: 'qa-kold114',
  EXPO_PUBLIC_KF_DEFAULT_BASE_URL:
    'https://grupofrio-gf-codex-dev-pr291-kold114-79983ae-38842081.dev.odoo.com',
  EXPO_PUBLIC_KF_ODOO_DB: 'grupofrio-gf-codex-dev-pr291-kold114-79983ae-38842081',
});

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
