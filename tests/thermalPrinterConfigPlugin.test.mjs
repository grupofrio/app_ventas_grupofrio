import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = process.cwd();
const pluginPath = resolve(repoRoot, 'modules/thermal-printer/app.plugin.js');

const bluetooth = 'android.permission.BLUETOOTH';
const bluetoothAdmin = 'android.permission.BLUETOOTH_ADMIN';
const bluetoothConnect = 'android.permission.BLUETOOTH_CONNECT';
const bluetoothScan = 'android.permission.BLUETOOTH_SCAN';

function minimalManifest(permissions = []) {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      'uses-permission': permissions,
      application: [{ $: { 'android:name': '.MainApplication' } }],
    },
  };
}

async function applyPlugin(manifest) {
  delete require.cache[pluginPath];
  const plugin = require(pluginPath);
  const config = plugin({
    name: 'Thermal printer plugin test',
    slug: 'thermal-printer-plugin-test',
    android: { package: 'mx.grupofrio.test' },
  });

  assert.equal(typeof config.mods?.android?.manifest, 'function', 'the plugin must register an Android manifest mod');

  const result = await config.mods.android.manifest({
    ...config,
    modResults: structuredClone(manifest),
    modRequest: {
      introspect: false,
      modName: 'manifest',
      platform: 'android',
      projectRoot: repoRoot,
      platformProjectRoot: resolve(repoRoot, 'android'),
    },
  });
  return result.modResults;
}

function permissionsNamed(manifest, name) {
  return (manifest.manifest['uses-permission'] ?? []).filter(
    (permission) => permission?.$?.['android:name'] === name,
  );
}

test('adds exactly the three required Bluetooth permissions to a minimal manifest', async () => {
  const manifest = await applyPlugin(minimalManifest());

  assert.deepEqual(manifest.manifest['uses-permission'], [
    { $: { 'android:name': bluetooth, 'android:maxSdkVersion': '30' } },
    { $: { 'android:name': bluetoothAdmin, 'android:maxSdkVersion': '30' } },
    { $: { 'android:name': bluetoothConnect } },
  ]);
  assert.equal(permissionsNamed(manifest, bluetoothScan).length, 0);
});

test('repairs duplicates idempotently while preserving permissions owned by other features', async () => {
  const camera = {
    $: {
      'android:name': 'android.permission.CAMERA',
      'android:required': 'false',
    },
  };
  const initial = minimalManifest([
    structuredClone(camera),
    { $: { 'android:name': bluetooth, 'android:maxSdkVersion': '28', 'android:required': 'false' } },
    { $: { 'android:name': bluetooth, 'android:maxSdkVersion': '29' } },
    { $: { 'android:name': bluetoothAdmin, 'android:maxSdkVersion': '31' } },
    { $: { 'android:name': bluetoothConnect, 'android:maxSdkVersion': '30' } },
  ]);

  const once = await applyPlugin(initial);
  const twice = await applyPlugin(once);

  assert.deepEqual(twice, once, 'running the plugin again must not change the manifest');
  assert.deepEqual(permissionsNamed(twice, 'android.permission.CAMERA'), [camera]);
  assert.equal(permissionsNamed(twice, bluetooth).length, 1);
  assert.equal(permissionsNamed(twice, bluetoothAdmin).length, 1);
  assert.equal(permissionsNamed(twice, bluetoothConnect).length, 1);
  assert.equal(permissionsNamed(twice, bluetooth)[0].$['android:maxSdkVersion'], '30');
  assert.equal(permissionsNamed(twice, bluetoothAdmin)[0].$['android:maxSdkVersion'], '30');
  assert.equal('android:maxSdkVersion' in permissionsNamed(twice, bluetoothConnect)[0].$, false);
  assert.equal(permissionsNamed(twice, bluetoothScan).length, 0);
});
