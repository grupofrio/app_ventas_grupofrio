import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

const repoRoot = process.cwd();
const moduleRoot = resolve(repoRoot, 'modules/thermal-printer');

function readModuleFile(relativePath) {
  const path = resolve(moduleRoot, relativePath);
  assert.equal(existsSync(path), true, `${relativePath} must exist in the tracked local module`);
  return readFileSync(path, 'utf8');
}

test('registers the local Android module and config plugin', () => {
  const moduleConfig = JSON.parse(readModuleFile('expo-module.config.json'));
  assert.deepEqual(moduleConfig, {
    platforms: ['android'],
    android: {
      modules: ['mx.grupofrio.thermalprinter.ThermalPrinterModule'],
    },
  });

  const appConfig = JSON.parse(readFileSync(resolve(repoRoot, 'app.json'), 'utf8'));
  assert.equal(
    appConfig.expo.plugins.includes('./modules/thermal-printer/app.plugin.js'),
    true,
    'app.json must register the tracked thermal-printer config plugin',
  );
});

test('uses an optional TypeScript boundary and exposes only the initial Expo module name', () => {
  const boundarySource = readModuleFile('src/ThermalPrinterModule.ts');
  const indexSource = readModuleFile('index.ts');
  const kotlinSource = readModuleFile(
    'android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterModule.kt',
  );

  assert.match(boundarySource, /requireOptionalNativeModule(?:<[^>]+>)?\(\s*['"]KoldThermalPrinter['"]\s*\)/);
  assert.doesNotMatch(boundarySource, /\brequireNativeModule\b/);
  assert.match(indexSource, /ThermalPrinterModule/);
  assert.match(kotlinSource, /Name\(\s*"KoldThermalPrinter"\s*\)/);
  assert.doesNotMatch(kotlinSource, /(?:AsyncFunction|Function|Events|Property)\s*\(/);
});

test('declares only the exact Bluetooth permissions in the module manifest', () => {
  const manifestSource = readModuleFile('android/src/main/AndroidManifest.xml');
  const document = new DOMParser().parseFromString(manifestSource, 'application/xml');
  const permissions = Array.from(document.getElementsByTagName('uses-permission')).map((element) => ({
    name: element.getAttribute('android:name'),
    maxSdkVersion: element.hasAttribute('android:maxSdkVersion')
      ? element.getAttribute('android:maxSdkVersion')
      : null,
  }));

  assert.deepEqual(permissions, [
    { name: 'android.permission.BLUETOOTH', maxSdkVersion: '30' },
    { name: 'android.permission.BLUETOOTH_ADMIN', maxSdkVersion: '30' },
    { name: 'android.permission.BLUETOOTH_CONNECT', maxSdkVersion: null },
  ]);

  const pluginSource = readModuleFile('app.plugin.js');
  assert.equal(manifestSource.includes('BLUETOOTH_SCAN'), false);
  assert.equal(pluginSource.includes('BLUETOOTH_SCAN'), false);
});

test('configures the Expo Android module build and native test toolchain', () => {
  const gradleSource = readModuleFile('android/build.gradle');

  for (const expected of [
    'ExpoModulesCorePlugin.gradle',
    'applyKotlinExpoModulesCorePlugin()',
    'useCoreDependencies()',
    'useDefaultAndroidSdkVersions()',
    'namespace "mx.grupofrio.thermalprinter"',
    'testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"',
    'unitTests.includeAndroidResources = true',
    'test.resources.srcDir("${rootProject.projectDir}/../fixtures")',
    "junit:junit:4.13.2",
    'com.google.truth:truth:',
    'org.robolectric:robolectric:4.11.1',
    'org.json:json:',
    'androidx.test:runner:',
    'androidx.test:core:',
    'androidx.test:rules:',
  ]) {
    assert.equal(gradleSource.includes(expected), true, `android/build.gradle must contain ${expected}`);
  }
});

test('tracks a structural verifier for the generated Android manifest', () => {
  const verifierPath = resolve(repoRoot, 'scripts/verify-thermal-printer-android.mjs');
  assert.equal(existsSync(verifierPath), true, 'the generated Android manifest verifier must exist');
  const verifierSource = readFileSync(verifierPath, 'utf8');
  assert.match(verifierSource, /readAndroidManifestAsync/);
});
