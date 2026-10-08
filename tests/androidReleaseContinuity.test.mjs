import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const expectedVersionCode = 10;
const expectedVersionName = '1.4.4';
const expectedEasOwner = 'grupofrio';
const expectedEasProjectId = '0a24997e-51fe-417a-a8d7-4bc83a1d7dff';
const expectedCorporateCertificateSha256 = 'c18ac1fab03b839e4e4c25fcedd99d59e16927b593a0e292cfd880287bd6f08c';
const expectedQaCertificateSha256 = '3b536a000d4dc09b77fd7704a535df506cdc33443dc7e80a7c4428b1f1369e54';

const appConfig = JSON.parse(readFileSync(resolve(repoRoot, 'app.json'), 'utf8'));
assert.equal(
  appConfig.expo.android.versionCode,
  expectedVersionCode,
  'app.json must advance Android versionCode for an in-place field update',
);
assert.equal(
  appConfig.expo.version,
  expectedVersionName,
  'app.json must identify the bearer-auth field release',
);
assert.equal(
  appConfig.expo.owner,
  expectedEasOwner,
  'app.json must use the Grupo Frio EAS organization',
);
assert.equal(
  appConfig.expo.extra.eas.projectId,
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
const releaseExpectationsSource = readFileSync(
  resolve(repoRoot, 'scripts/android-release-expectations.mjs'),
  'utf8',
);
assert.match(
  verifierSource,
  /versionCode:\s*'10'/,
  'release verification must require Android versionCode 10',
);
assert.match(
  verifierSource,
  /versionName:\s*'1\.4\.4'/,
  'release verification must require Android versionName 1.4.4',
);
assert.match(
  releaseExpectationsSource,
  new RegExp(expectedCorporateCertificateSha256),
  'release verification must require the Grupo Frio corporate certificate',
);
assert.match(
  releaseExpectationsSource,
  new RegExp(expectedQaCertificateSha256),
  'release verification must pin the isolated QA certificate for the .dev package',
);
assert.match(
  releaseExpectationsSource,
  /mx\.grupofrio\.koldfield\.dev/,
  'release verification must bind the QA certificate to the isolated .dev package',
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
    /defaultConfig\s*\{[\s\S]*?versionCode\s+10\b/,
    'the generated native Android project must use versionCode 10 when present',
  );
}

console.log('android release continuity tests: ok');
