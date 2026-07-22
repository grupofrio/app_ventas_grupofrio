const { createRunOncePlugin, withAndroidManifest } = require('@expo/config-plugins');

const REQUIRED_PERMISSIONS = [
  {
    name: 'android.permission.BLUETOOTH',
    maxSdkVersion: '30',
  },
  {
    name: 'android.permission.BLUETOOTH_ADMIN',
    maxSdkVersion: '30',
  },
  {
    name: 'android.permission.BLUETOOTH_CONNECT',
  },
];

function upsertPermission(androidManifest, requiredPermission) {
  const manifest = androidManifest.manifest;
  const permissions = manifest['uses-permission'] ?? [];
  const matches = permissions.filter(
    (permission) => permission?.$?.['android:name'] === requiredPermission.name,
  );

  const permission = matches[0] ?? {
    $: { 'android:name': requiredPermission.name },
  };
  permission.$ ??= {};
  permission.$['android:name'] = requiredPermission.name;

  if (requiredPermission.maxSdkVersion) {
    permission.$['android:maxSdkVersion'] = requiredPermission.maxSdkVersion;
  } else {
    delete permission.$['android:maxSdkVersion'];
  }

  manifest['uses-permission'] = permissions.filter(
    (candidate) =>
      candidate === permission || candidate?.$?.['android:name'] !== requiredPermission.name,
  );
  if (!manifest['uses-permission'].includes(permission)) {
    manifest['uses-permission'].push(permission);
  }
}

function withThermalPrinterPermissions(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    for (const permission of REQUIRED_PERMISSIONS) {
      upsertPermission(manifestConfig.modResults, permission);
    }
    return manifestConfig;
  });
}

module.exports = createRunOncePlugin(
  withThermalPrinterPermissions,
  'withKoldThermalPrinter',
  '1.0.0',
);
