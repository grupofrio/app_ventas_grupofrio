import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { AndroidConfig } = require('@expo/config-plugins');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MANIFEST_PATH = resolve(
  repoRoot,
  'android/app/src/main/AndroidManifest.xml',
);

const permissionTags = ['uses-permission', 'uses-permission-sdk-23'];
const requiredPermissions = new Map([
  ['android.permission.BLUETOOTH', '30'],
  ['android.permission.BLUETOOTH_ADMIN', '30'],
  ['android.permission.BLUETOOTH_CONNECT', null],
]);

function permissionsNamed(permissions, name) {
  return permissions.filter((permission) => permission?.$?.['android:name'] === name);
}

function readPermissionEntries(manifest, manifestPath) {
  return permissionTags.flatMap((tagName) => {
    const entries = manifest[tagName];
    if (entries === undefined) {
      return [];
    }
    if (!Array.isArray(entries)) {
      throw new Error(
        `Invalid Android manifest at ${manifestPath}: <${tagName}> entries must be an array`,
      );
    }
    return entries;
  });
}

export async function verifyThermalPrinterAndroidManifest(
  manifestPath = DEFAULT_MANIFEST_PATH,
) {
  const resolvedManifestPath = resolve(manifestPath);
  try {
    await access(resolvedManifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read Android manifest at ${resolvedManifestPath}: ${message}`,
      { cause: error },
    );
  }

  let androidManifest;
  try {
    androidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(resolvedManifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Invalid manifest')) {
      throw new Error(
        `Invalid Android manifest at ${resolvedManifestPath}: missing <manifest> root`,
        { cause: error },
      );
    }
    throw new Error(
      `Unable to read Android manifest at ${resolvedManifestPath}: ${message}`,
      { cause: error },
    );
  }

  const manifest = androidManifest?.manifest;
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(
      `Invalid Android manifest at ${resolvedManifestPath}: missing <manifest> root`,
    );
  }
  const permissions = readPermissionEntries(manifest, resolvedManifestPath);

  for (const [name, expectedMaxSdkVersion] of requiredPermissions) {
    const matches = permissionsNamed(permissions, name);
    if (matches.length !== 1) {
      throw new Error(
        `Expected ${name} exactly once across Android permission tags in ${resolvedManifestPath}, found ${matches.length}`,
      );
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
    throw new Error(
      `${forbiddenPermission} must be absent from all Android permission tags in ${resolvedManifestPath}`,
    );
  }

  return resolvedManifestPath;
}

const entrypointUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entrypointUrl === import.meta.url) {
  const requestedManifestPath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : DEFAULT_MANIFEST_PATH;

  verifyThermalPrinterAndroidManifest(requestedManifestPath)
    .then((verifiedPath) => {
      console.log(`Thermal printer Android permissions verified in ${verifiedPath}`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Thermal printer Android verification failed: ${message}`);
      process.exitCode = 1;
    });
}
