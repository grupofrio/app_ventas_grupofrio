import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { AndroidConfig } = require('@expo/config-plugins');

const manifestPath = resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
const requiredPermissions = new Map([
  ['android.permission.BLUETOOTH', '30'],
  ['android.permission.BLUETOOTH_ADMIN', '30'],
  ['android.permission.BLUETOOTH_CONNECT', null],
]);

function permissionsNamed(permissions, name) {
  return permissions.filter((permission) => permission?.$?.['android:name'] === name);
}

async function main() {
  const androidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
  const permissions = androidManifest.manifest['uses-permission'] ?? [];

  for (const [name, expectedMaxSdkVersion] of requiredPermissions) {
    const matches = permissionsNamed(permissions, name);
    if (matches.length !== 1) {
      throw new Error(`Expected ${name} exactly once in ${manifestPath}, found ${matches.length}`);
    }

    const attributes = matches[0].$ ?? {};
    if (expectedMaxSdkVersion === null) {
      if ('android:maxSdkVersion' in attributes) {
        throw new Error(`${name} must not declare android:maxSdkVersion`);
      }
    } else if (attributes['android:maxSdkVersion'] !== expectedMaxSdkVersion) {
      throw new Error(
        `${name} must declare android:maxSdkVersion="${expectedMaxSdkVersion}"`,
      );
    }
  }

  const forbiddenPermission = 'android.permission.BLUETOOTH_SCAN';
  const forbiddenMatches = permissionsNamed(permissions, forbiddenPermission);
  if (forbiddenMatches.length > 0) {
    throw new Error(`${forbiddenPermission} must be absent from ${manifestPath}`);
  }

  console.log(`Thermal printer Android permissions verified in ${manifestPath}`);
}

main().catch((error) => {
  console.error(`Thermal printer Android verification failed: ${error.message}`);
  process.exitCode = 1;
});
