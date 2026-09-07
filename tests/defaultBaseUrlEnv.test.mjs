import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

assert.ok(eas.build['staging-android'], 'eas.json must define a staging Android build profile');
assert.ok(eas.build['staging-ios'], 'eas.json must define a staging iOS build profile');
assert.ok(eas.build['production-android'], 'eas.json must define a production Android build profile');
assert.ok(eas.build['production-ios'], 'eas.json must define a production iOS build profile');
assert.equal(eas.build.preview, undefined, 'preview profile should be removed after staging rollout');
assert.equal(
  eas.build['staging-android'].env.EXPO_PUBLIC_APP_ENV,
  'staging',
  'staging Android profile must expose EXPO_PUBLIC_APP_ENV=staging',
);
assert.equal(
  eas.build['staging-android'].env.EXPO_PUBLIC_KF_DEFAULT_BASE_URL,
  'https://grupofrio-gf-staging280826-37235488.dev.odoo.com',
  'staging Android profile must target the staging Odoo host without the /odoo suffix',
);
assert.equal(
  eas.build['staging-android'].env.EXPO_PUBLIC_KF_ODOO_DB,
  'grupofrio-gf-staging280826-37235488',
  'staging Android profile must target the staging Odoo database',
);
assert.equal(
  eas.build['staging-ios'].env.EXPO_PUBLIC_APP_ENV,
  'staging',
  'staging iOS profile must expose EXPO_PUBLIC_APP_ENV=staging',
);
assert.equal(
  eas.build['staging-ios'].env.EXPO_PUBLIC_KF_DEFAULT_BASE_URL,
  'https://grupofrio-gf-staging280826-37235488.dev.odoo.com',
  'staging iOS profile must target the staging Odoo host without the /odoo suffix',
);
assert.equal(
  eas.build['staging-ios'].env.EXPO_PUBLIC_KF_ODOO_DB,
  'grupofrio-gf-staging280826-37235488',
  'staging iOS profile must target the staging Odoo database',
);
assert.equal(
  eas.build.development.env.EXPO_PUBLIC_APP_ENV,
  'development',
  'development profile must preserve its runtime environment flag',
);
assert.equal(
  eas.build.development.android.buildType,
  'apk',
  'development profile must remain an APK-oriented technical build',
);
assert.equal(
  eas.build['staging-android'].distribution,
  'internal',
  'staging Android profile must stay as an internal APK build',
);
assert.equal(
  packageJson.scripts['build:staging:ios'],
  'eas build -p ios --profile staging-ios',
  'package.json must expose an iOS staging build command',
);
assert.equal(
  packageJson.scripts['build:prod:ios'],
  'eas build -p ios --profile production-ios',
  'package.json must expose an iOS production build command',
);
assert.equal(
  packageJson.scripts['build:staging:android'],
  'eas build -p android --profile staging-android',
  'package.json must expose an Android staging build command',
);
assert.equal(
  packageJson.scripts['build:prod:android'],
  'eas build -p android --profile production-android',
  'package.json must expose an Android production build command',
);

const productionApk = eas.build['production-apk'];
assert.ok(productionApk, 'production-apk profile must exist for direct Android distribution');
assert.equal(productionApk.distribution, 'internal');
assert.equal(productionApk.android?.buildType, 'apk');
assert.deepEqual(productionApk.env, {
  EXPO_PUBLIC_BUILD_PROFILE: 'production-apk',
  EXPO_PUBLIC_KF_DEFAULT_BASE_URL: 'https://grupofrio-gf.odoo.com',
  EXPO_PUBLIC_KF_ODOO_DB: 'grupofrio-gf-main-34980678',
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
