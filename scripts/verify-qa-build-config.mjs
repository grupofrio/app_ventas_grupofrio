import assert from 'node:assert/strict';
import { transformFileSync } from '@babel/core';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expectedAndroidCertificate } from './android-release-expectations.mjs';

const QA_PROFILE = 'qa-kold114';
const DEVELOPMENT_BUILD = 38842081;
const DEVELOPMENT_HOST = 'https://grupofrio-gf-codex-dev-pr291-kold114-79983ae-38842081.dev.odoo.com';
const DEVELOPMENT_DB = 'grupofrio-gf-codex-dev-pr291-kold114-79983ae-38842081';
const QA_APPLICATION_ID = 'mx.grupofrio.koldfield.dev';
const PRODUCTION_HOST = 'https://grupofrio-gf.odoo.com';
const PRODUCTION_DB = 'grupofrio-gf-main-34980678';
const PUBLIC_ENV_KEYS = [
  'KF_LOCAL_DEV',
  'EXPO_PUBLIC_BUILD_PROFILE',
  'EXPO_PUBLIC_KF_DEFAULT_BASE_URL',
  'EXPO_PUBLIC_KF_ODOO_DB',
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const args = process.argv.slice(2);

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const requestedProfile = readArg('--profile')
  || process.env.EAS_BUILD_PROFILE
  || process.env.EXPO_PUBLIC_BUILD_PROFILE;

// EAS executes this lifecycle hook for every profile. Non-QA builds keep their
// existing behavior; the explicit local command always passes --profile.
if (!requestedProfile || requestedProfile !== QA_PROFILE) {
  process.exit(0);
}

const easConfigPath = path.resolve(readArg('--eas-config') || path.join(repoRoot, 'eas.json'));
const easConfig = JSON.parse(readFileSync(easConfigPath, 'utf8'));
const profile = easConfig.build?.[requestedProfile];
assert.ok(profile, `Missing EAS build profile ${requestedProfile}`);
assert.equal(profile.environment, 'preview', 'QA must use the explicit EAS preview environment');
assert.equal(profile.credentialsSource, 'remote', 'QA must use its assigned remote Android credential');
assert.equal(profile.distribution, 'internal', 'QA must remain an internal build');
assert.equal(profile.android?.buildType, 'apk', 'QA must produce an APK');

const configured = profile.env ?? {};
assert.equal(configured.KF_LOCAL_DEV, '1', 'QA must resolve the isolated .dev application');
assert.equal(configured.EXPO_PUBLIC_BUILD_PROFILE, QA_PROFILE, 'QA profile marker is required');
assert.notEqual(
  configured.EXPO_PUBLIC_KF_DEFAULT_BASE_URL,
  PRODUCTION_HOST,
  'QA must resolve the authorized Development hostname',
);
assert.notEqual(
  configured.EXPO_PUBLIC_KF_ODOO_DB,
  PRODUCTION_DB,
  'QA must resolve the authorized Development database',
);
assert.ok(
  configured.EXPO_PUBLIC_KF_DEFAULT_BASE_URL?.includes(String(DEVELOPMENT_BUILD))
    && configured.EXPO_PUBLIC_KF_ODOO_DB?.includes(String(DEVELOPMENT_BUILD)),
  `QA must explicitly target Development build ${DEVELOPMENT_BUILD}`,
);
assert.equal(
  configured.EXPO_PUBLIC_KF_DEFAULT_BASE_URL,
  DEVELOPMENT_HOST,
  'QA must resolve the authorized Development hostname',
);
assert.equal(
  configured.EXPO_PUBLIC_KF_ODOO_DB,
  DEVELOPMENT_DB,
  'QA must resolve the authorized Development database',
);

// On EAS, verify the values that actually reached the worker, not only eas.json.
if (process.env.EAS_BUILD === 'true' || process.env.EAS_BUILD_PROFILE || process.env.EXPO_PUBLIC_BUILD_PROFILE) {
  for (const key of PUBLIC_ENV_KEYS) {
    assert.equal(process.env[key], configured[key], `${key} differs from the QA profile on the build worker`);
  }
}

const previousEnv = Object.fromEntries(PUBLIC_ENV_KEYS.map((key) => [key, process.env[key]]));
Object.assign(process.env, configured);
try {
  const require = createRequire(import.meta.url);
  const createExpoConfig = require(path.join(repoRoot, 'app.config.js'));
  const resolved = createExpoConfig();
  assert.equal(resolved.android?.package, QA_APPLICATION_ID, 'QA must resolve the isolated Android package');
  assert.equal(resolved.version, '1.4.4');
  assert.equal(resolved.android?.versionCode, 10);

  // Prove Babel can inline the legacy computed environment access before Metro
  // bundles it. The previous build failed exactly at this boundary.
  for (const [relativePath, expectedValue, forbiddenValue, variableName] of [
    ['src/services/api.ts', DEVELOPMENT_HOST, PRODUCTION_HOST, 'EXPO_PUBLIC_KF_DEFAULT_BASE_URL'],
    ['src/services/odooDatabase.ts', DEVELOPMENT_DB, PRODUCTION_DB, 'EXPO_PUBLIC_KF_ODOO_DB'],
  ]) {
    const transformed = transformFileSync(path.join(repoRoot, relativePath), {
      cwd: repoRoot,
      configFile: path.join(repoRoot, 'babel.config.js'),
      babelrc: false,
      filename: path.join(repoRoot, relativePath),
    })?.code ?? '';
    assert.ok(transformed.includes(expectedValue), `${variableName} was not inlined by Babel`);
    assert.ok(!transformed.includes(variableName), `${variableName} survived as a runtime lookup`);
    assert.ok(!transformed.includes(forbiddenValue), `${variableName} retained a production fallback`);
  }

  const result = {
    profile: QA_PROFILE,
    developmentBuild: DEVELOPMENT_BUILD,
    publicBaseUrl: configured.EXPO_PUBLIC_KF_DEFAULT_BASE_URL,
    publicOdooDb: configured.EXPO_PUBLIC_KF_ODOO_DB,
    applicationId: resolved.android.package,
    version: resolved.version,
    versionCode: resolved.android.versionCode,
    certificateSha256: expectedAndroidCertificate(resolved.android.package),
    remoteCredentials: profile.credentialsSource === 'remote',
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  for (const key of PUBLIC_ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
}
