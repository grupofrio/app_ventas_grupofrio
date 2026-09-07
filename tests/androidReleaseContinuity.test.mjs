import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const expectedVersionCode = 6;
const expectedVersionName = '1.4.2';
const expectedEasOwner = 'grupofrio';
const expectedEasProjectId = '0a24997e-51fe-417a-a8d7-4bc83a1d7dff';
const expectedCorporateCertificateSha256 = 'c18ac1fab03b839e4e4c25fcedd99d59e16927b593a0e292cfd880287bd6f08c';

const { buildExpoConfig } = await import('../app.config.ts');
const appConfig = buildExpoConfig({ EXPO_PUBLIC_APP_ENV: 'production' });
assert.equal(
  appConfig.android.versionCode,
  expectedVersionCode,
  'app.json must advance Android versionCode for an in-place field update',
);
assert.equal(
  appConfig.version,
  expectedVersionName,
  'app.json must identify the bearer-auth field release',
);
assert.equal(
  appConfig.owner,
  expectedEasOwner,
  'app.json must use the Grupo Frio EAS organization',
);
assert.equal(
  appConfig.extra.eas.projectId,
  expectedEasProjectId,
  'app.json must use the Grupo Frio EAS project that owns Android credentials',
);

const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
assert.equal(
  packageJson.version,
  expectedVersionName,
  'package.json version must match the Android field release',
);
assert.equal(
  packageJson.scripts['build:field-update:android'],
  'npx expo prebuild --platform android --no-install && cd android && ./gradlew --no-daemon --no-parallel assembleRelease',
  'field-update builds must regenerate native Android config and serialize Gradle before assembling release',
);

const verifierSource = readFileSync(resolve(repoRoot, 'scripts/verify-android-release.mjs'), 'utf8');
assert.match(
  verifierSource,
  /versionCode:\s*'6'/,
  'release verification must require Android versionCode 6',
);
assert.match(
  verifierSource,
  /versionName:\s*'1\.4\.2'/,
  'release verification must require Android versionName 1.4.2',
);
assert.match(
  verifierSource,
  new RegExp(expectedCorporateCertificateSha256),
  'release verification must require the Grupo Frio corporate certificate',
);
assert.match(
  verifierSource,
  /process\.env\.APK_PATH/,
  'release verification must support an explicit downloaded EAS APK path',
);
assert.doesNotMatch(
  verifierSource,
  /output-metadata\.json|metadataPath/,
  'release verification must inspect the built APK, not optional Gradle metadata',
);

const nativeBuildGradle = resolve(repoRoot, 'android/app/build.gradle');
if (existsSync(nativeBuildGradle)) {
  const nativeSource = readFileSync(nativeBuildGradle, 'utf8');
  assert.match(
    nativeSource,
    /defaultConfig\s*\{[\s\S]*?versionCode\s+6\b/,
    'the generated native Android project must use versionCode 6 when present',
  );
}

console.log('android release continuity tests: ok');
