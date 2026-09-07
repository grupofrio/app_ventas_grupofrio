import test from 'node:test';
import assert from 'node:assert/strict';

const { buildExpoConfig } = await import('../app.config.ts');

test('production config keeps official identity', () => {
  const config = buildExpoConfig({
    EXPO_PUBLIC_APP_ENV: 'production',
    EXPO_PUBLIC_KF_DEFAULT_BASE_URL: 'https://grupofrio-gf.odoo.com',
    EXPO_PUBLIC_KF_ODOO_DB: 'grupofrio-gf-main-34980678',
  });

  assert.equal(config.name, 'KOLD Field');
  assert.equal(config.slug, 'kold-field');
  assert.equal(config.scheme, 'kold-field');
  assert.equal(config.ios.bundleIdentifier, 'mx.grupofrio.koldfield');
  assert.equal(config.android.package, 'mx.grupofrio.koldfield');
  assert.equal(config.extra.appEnvironment, 'production');
  assert.equal(config.extra.defaultBaseUrl, 'https://grupofrio-gf.odoo.com');
  assert.equal(config.extra.eas.projectId, '0a24997e-51fe-417a-a8d7-4bc83a1d7dff');
});

test('staging config changes visible identity and backend target', () => {
  const config = buildExpoConfig({
    EXPO_PUBLIC_APP_ENV: 'staging',
    EXPO_PUBLIC_KF_DEFAULT_BASE_URL: 'https://grupofrio-gf-staging280826-37133857.dev.odoo.com',
    EXPO_PUBLIC_KF_ODOO_DB: 'grupofrio-gf-staging280826-37133857',
  });

  assert.equal(config.name, 'KOLD Field Staging');
  assert.equal(config.slug, 'kold-field');
  assert.equal(config.scheme, 'kold-field-staging');
  assert.equal(config.ios.bundleIdentifier, 'mx.grupofrio.koldfield.staging');
  assert.equal(config.android.package, 'mx.grupofrio.koldfield.staging');
  assert.equal(config.extra.appEnvironment, 'staging');
  assert.equal(
    config.extra.defaultBaseUrl,
    'https://grupofrio-gf-staging280826-37133857.dev.odoo.com',
  );
  assert.equal(config.extra.defaultOdooDb, 'grupofrio-gf-staging280826-37133857');
  assert.equal(config.extra.eas.projectId, '0a24997e-51fe-417a-a8d7-4bc83a1d7dff');
});

test('development keeps dev runtime metadata but reuses the staging native identity', () => {
  const config = buildExpoConfig({
    EXPO_PUBLIC_APP_ENV: 'development',
    EXPO_PUBLIC_KF_DEFAULT_BASE_URL: 'https://grupofrio-gf-staging280826-37133857.dev.odoo.com',
    EXPO_PUBLIC_KF_ODOO_DB: 'grupofrio-gf-staging280826-37133857',
  });

  assert.equal(config.name, 'KOLD Field Staging');
  assert.equal(config.slug, 'kold-field');
  assert.equal(config.scheme, 'kold-field-staging');
  assert.equal(config.ios.bundleIdentifier, 'mx.grupofrio.koldfield.staging');
  assert.equal(config.android.package, 'mx.grupofrio.koldfield.staging');
  assert.equal(config.extra.appEnvironment, 'development');
  assert.equal(
    config.extra.defaultBaseUrl,
    'https://grupofrio-gf-staging280826-37133857.dev.odoo.com',
  );
  assert.equal(config.extra.defaultOdooDb, 'grupofrio-gf-staging280826-37133857');
  assert.equal(config.extra.eas.projectId, '0a24997e-51fe-417a-a8d7-4bc83a1d7dff');
});
