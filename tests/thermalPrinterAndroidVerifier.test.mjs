import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const verifierPath = resolve(repoRoot, 'scripts/verify-thermal-printer-android.mjs');
const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'thermal-printer-verifier-'));

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

const bluetooth = 'android.permission.BLUETOOTH';
const bluetoothAdmin = 'android.permission.BLUETOOTH_ADMIN';
const bluetoothConnect = 'android.permission.BLUETOOTH_CONNECT';
const bluetoothScan = 'android.permission.BLUETOOTH_SCAN';

const validPermissions = [
  { name: bluetooth, maxSdkVersion: '30' },
  { name: bluetoothAdmin, maxSdkVersion: '30' },
  { name: bluetoothConnect },
];

function renderManifest(permissions) {
  const lines = permissions.map(({ tag = 'uses-permission', name, maxSdkVersion }) => {
    const maximum = maxSdkVersion === undefined
      ? ''
      : ` android:maxSdkVersion="${maxSdkVersion}"`;
    return `  <${tag} android:name="${name}"${maximum} />`;
  });
  return [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    ...lines,
    '</manifest>',
    '',
  ].join('\n');
}

function writeManifest(name, permissions, source = renderManifest(permissions)) {
  const manifestPath = resolve(temporaryRoot, name);
  writeFileSync(manifestPath, source, 'utf8');
  return manifestPath;
}

function runVerifier(manifestPath, cwd = repoRoot) {
  return spawnSync(process.execPath, [verifierPath, manifestPath], {
    cwd,
    encoding: 'utf8',
  });
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('accepts required permissions across both valid Android permission tags', () => {
  const manifestPath = writeManifest('valid-sdk-23.xml', [
    { ...validPermissions[0], tag: 'uses-permission-sdk-23' },
    validPermissions[1],
    { ...validPermissions[2], tag: 'uses-permission-sdk-23' },
  ]);

  const result = runVerifier(manifestPath, temporaryRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(escapeRegExp(manifestPath)));
});

test('keeps the default CLI manifest path repo-rooted when launched from another cwd', () => {
  const expectedManifestPath = resolve(repoRoot, 'android/app/src/main/AndroidManifest.xml');
  const wrongCwdPath = resolve(temporaryRoot, 'android/app/src/main/AndroidManifest.xml');
  const result = spawnSync(process.execPath, [verifierPath], {
    cwd: temporaryRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.match(output, new RegExp(escapeRegExp(expectedManifestPath)));
  assert.doesNotMatch(output, new RegExp(escapeRegExp(wrongCwdPath)));
});

const invalidCases = [
  {
    name: 'missing-required.xml',
    permissions: validPermissions.filter(({ name }) => name !== bluetoothAdmin),
    expected: /BLUETOOTH_ADMIN.*found 0/,
  },
  {
    name: 'duplicate-normal.xml',
    permissions: [...validPermissions, validPermissions[0]],
    expected: /BLUETOOTH.*found 2/,
  },
  {
    name: 'duplicate-cross-tag.xml',
    permissions: [
      ...validPermissions,
      { ...validPermissions[0], tag: 'uses-permission-sdk-23' },
    ],
    expected: /BLUETOOTH.*found 2/,
  },
  {
    name: 'legacy-wrong-max.xml',
    permissions: validPermissions.map((permission) =>
      permission.name === bluetooth ? { ...permission, maxSdkVersion: '29' } : permission,
    ),
    expected: /BLUETOOTH.*maxSdkVersion="30"/,
  },
  {
    name: 'legacy-missing-max.xml',
    permissions: validPermissions.map((permission) =>
      permission.name === bluetoothAdmin
        ? { name: permission.name }
        : permission,
    ),
    expected: /BLUETOOTH_ADMIN.*maxSdkVersion="30"/,
  },
  {
    name: 'connect-with-max.xml',
    permissions: validPermissions.map((permission) =>
      permission.name === bluetoothConnect
        ? { ...permission, maxSdkVersion: '30' }
        : permission,
    ),
    expected: /BLUETOOTH_CONNECT.*must not declare android:maxSdkVersion/,
  },
  {
    name: 'scan-normal.xml',
    permissions: [...validPermissions, { name: bluetoothScan }],
    expected: /BLUETOOTH_SCAN.*must be absent/,
  },
  {
    name: 'scan-sdk-23.xml',
    permissions: [
      ...validPermissions,
      { tag: 'uses-permission-sdk-23', name: bluetoothScan },
    ],
    expected: /BLUETOOTH_SCAN.*must be absent/,
  },
];

for (const invalidCase of invalidCases) {
  test(`rejects ${invalidCase.name}`, () => {
    const manifestPath = writeManifest(invalidCase.name, invalidCase.permissions);
    const result = runVerifier(manifestPath);

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, invalidCase.expected);
  });
}

test('reports a clear error for a missing manifest path', () => {
  const missingPath = resolve(temporaryRoot, 'does-not-exist.xml');
  const result = runVerifier(missingPath);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to read Android manifest/);
  assert.match(result.stderr, /does-not-exist\.xml/);
});

test('reports a clear error for a document without a manifest root', () => {
  const manifestPath = writeManifest('invalid-structure.xml', [], '<application />\n');
  const result = runVerifier(manifestPath);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid Android manifest.*missing <manifest> root/);
  assert.doesNotMatch(result.stderr, /Cannot read properties/);
});

test('exports a testable verifier function', async () => {
  const moduleUrl = `${pathToFileURL(verifierPath).href}?test=${Date.now()}`;
  const verifierModule = await import(moduleUrl);
  const manifestPath = writeManifest('valid-import.xml', validPermissions);

  assert.equal(typeof verifierModule.verifyThermalPrinterAndroidManifest, 'function');
  await verifierModule.verifyThermalPrinterAndroidManifest(manifestPath);
  assert.equal(dirname(verifierModule.DEFAULT_MANIFEST_PATH), resolve(repoRoot, 'android/app/src/main'));
});

test('does not run the CLI or write output when imported', () => {
  const moduleUrl = `${pathToFileURL(verifierPath).href}?import-safety=${Date.now()}`;
  const probe = [
    `const verifier = await import(${JSON.stringify(moduleUrl)});`,
    "if (typeof verifier.verifyThermalPrinterAndroidManifest !== 'function') process.exit(2);",
    "console.log('import-ok');",
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', probe],
    { cwd: temporaryRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'import-ok\n');
  assert.equal(result.stderr, '');
});
