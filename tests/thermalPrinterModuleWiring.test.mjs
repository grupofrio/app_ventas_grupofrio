import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

test('uses an optional TypeScript boundary and exposes the exact native printer API', () => {
  const boundarySource = readModuleFile('src/ThermalPrinterModule.ts');
  const sharedTypesSource = readFileSync(
    resolve(repoRoot, 'src/services/thermalPrinterTypes.ts'),
    'utf8',
  );
  const indexSource = readModuleFile('index.ts');
  const kotlinSource = readModuleFile(
    'android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterModule.kt',
  );

  assert.match(boundarySource, /requireOptionalNativeModule(?:<[^>]+>)?\(\s*['"]KoldThermalPrinter['"]\s*\)/);
  assert.doesNotMatch(boundarySource, /\brequireNativeModule\b/);
  assert.match(indexSource, /ThermalPrinterModule/);
  assert.match(kotlinSource, /Name\(\s*"KoldThermalPrinter"\s*\)/);
  assert.deepEqual(
    Array.from(kotlinSource.matchAll(/AsyncFunction\(\s*["']([^"']+)["']\s*\)/g), (match) => match[1]),
    ['getBluetoothState', 'getBondedDevices', 'printTicket', 'printDiagnostic'],
  );
  assert.match(boundarySource, /printTicket\(\s*address:\s*string,\s*document:\s*ThermalTicketDocument/);
  assert.match(boundarySource, /Promise<NativePrintResult>/);
  for (const field of [
    'transportBytesWritten',
    'rasterBytesWritten',
    'bandsCompleted',
    'rasterPayloadAttempted',
  ]) {
    assert.match(boundarySource + sharedTypesSource, new RegExp(`\\b${field}\\b`));
  }
  assert.match(boundarySource, /printDiagnostic\(\s*address:\s*string,\s*branding:\s*ThermalTicketBranding/);
  assert.doesNotMatch(kotlinSource, /\b(?:Function|Events|Property)\s*\(/);

  const diagnosticSource = readModuleFile(
    'android/src/main/java/mx/grupofrio/thermalprinter/DiagnosticTicketFactory.kt',
  );
  assert.doesNotMatch(diagnosticSource, /SOLUCIONES EN PRODUCCION GLACIEM|SPG230420F52/);
  assert.doesNotMatch(diagnosticSource, /iVBOR[A-Za-z0-9+/=]{16,}/);
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

  for (const relativePath of [
    'android/src/main/java/mx/grupofrio/thermalprinter/ThermalPrinterModule.kt',
    'android/src/main/java/mx/grupofrio/thermalprinter/BluetoothDeviceDirectory.kt',
    'android/src/main/java/mx/grupofrio/thermalprinter/BluetoothPrinterTransport.kt',
  ]) {
    const productionSource = readModuleFile(relativePath);
    assert.equal(productionSource.includes('BLUETOOTH_SCAN'), false);
    assert.equal(productionSource.includes('startDiscovery'), false);
  }
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

test('ignores nested Gradle build output from the tracked local module', () => {
  const probePath = 'modules/thermal-printer/android/build/generated-probe.bin';
  const result = spawnSync(
    'git',
    ['check-ignore', '--quiet', '--no-index', probePath],
    { cwd: repoRoot },
  );

  assert.equal(
    result.status,
    0,
    `${probePath} must be ignored so native compilation cannot dirty the worktree`,
  );
});
