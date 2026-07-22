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
const PERMISSION_TAGS = ['uses-permission', 'uses-permission-sdk-23'];

function removeManifestMergerDirectives(attributes) {
  for (const attributeName of Object.keys(attributes)) {
    if (attributeName.startsWith('tools:')) {
      delete attributes[attributeName];
    }
  }
}

function upsertPermission(androidManifest, requiredPermission) {
  const manifest = androidManifest.manifest;
  const matches = PERMISSION_TAGS.flatMap((tagName) =>
    (manifest[tagName] ?? []).filter(
      (permission) => permission?.$?.['android:name'] === requiredPermission.name,
    ),
  );

  const permission = matches[0] ?? {
    $: { 'android:name': requiredPermission.name },
  };
  permission.$ ??= {};
  permission.$['android:name'] = requiredPermission.name;
  removeManifestMergerDirectives(permission.$);

  if (requiredPermission.maxSdkVersion) {
    permission.$['android:maxSdkVersion'] = requiredPermission.maxSdkVersion;
  } else {
    delete permission.$['android:maxSdkVersion'];
  }

  for (const tagName of PERMISSION_TAGS) {
    if (manifest[tagName]) {
      manifest[tagName] = manifest[tagName].filter(
        (candidate) => candidate?.$?.['android:name'] !== requiredPermission.name,
      );
    }
  }

  manifest['uses-permission'] ??= [];
  manifest['uses-permission'].push(permission);
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
