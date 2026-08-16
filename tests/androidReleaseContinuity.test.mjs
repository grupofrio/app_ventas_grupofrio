import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const expectedVersionCode = 5;
const expectedVersionName = '1.4.1';

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

const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
assert.equal(
  packageJson.version,
  expectedVersionName,
  'package.json version must match the Android field release',
);
assert.equal(
  packageJson.scripts['build:field-update:android'],
  'cd android && ./gradlew clean assembleRelease',
  'field-update builds must clean stale native outputs before assembling release',
);

const verifierSource = readFileSync(resolve(repoRoot, 'scripts/verify-android-release.mjs'), 'utf8');
assert.match(
  verifierSource,
  /versionCode:\s*'5'/,
  'release verification must require Android versionCode 5',
);
assert.match(
  verifierSource,
  /versionName:\s*'1\.4\.1'/,
  'release verification must require Android versionName 1.4.1',
);

const nativeBuildGradle = resolve(repoRoot, 'android/app/build.gradle');
if (existsSync(nativeBuildGradle)) {
  const nativeSource = readFileSync(nativeBuildGradle, 'utf8');
  assert.match(
    nativeSource,
    /defaultConfig\s*\{[\s\S]*?versionCode\s+5\b/,
    'the generated native Android project must use versionCode 5 when present',
  );
}

console.log('android release continuity tests: ok');
