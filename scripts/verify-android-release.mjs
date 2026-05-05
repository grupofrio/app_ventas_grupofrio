import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const EXPECTED = {
  apkPath: path.resolve('android/app/build/outputs/apk/release/app-release.apk'),
  metadataPath: path.resolve('android/app/build/outputs/apk/release/output-metadata.json'),
  applicationId: 'mx.grupofrio.koldfield',
  versionCode: '2',
  versionName: '1.3.1',
  certSha256: 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c',
};

function findAndroidTool(toolName) {
  const sdkRoot = process.env.ANDROID_SDK_ROOT
    || process.env.ANDROID_HOME
    || path.join(os.homedir(), 'Library/Android/sdk');
  const buildToolsDir = path.join(sdkRoot, 'build-tools');

  if (!existsSync(buildToolsDir)) {
    throw new Error(`Android build-tools no encontrado en ${buildToolsDir}`);
  }

  const versions = readdirSync(buildToolsDir)
    .filter((entry) => existsSync(path.join(buildToolsDir, entry, toolName)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (versions.length === 0) {
    throw new Error(`No se encontró ${toolName} dentro de ${buildToolsDir}`);
  }

  return path.join(buildToolsDir, versions.at(-1), toolName);
}

function parseBadging(output) {
  const match = output.match(
    /package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/
  );

  if (!match) {
    throw new Error('No se pudo parsear `aapt dump badging`.');
  }

  return {
    applicationId: match[1],
    versionCode: match[2],
    versionName: match[3],
  };
}

function parseSigner(output) {
  const match = output.match(/Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/i);

  if (!match) {
    throw new Error('No se pudo extraer el SHA-256 del certificado desde apksigner.');
  }

  return match[1].toLowerCase();
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} inválido. Esperado: ${expected}. Actual: ${actual}.`);
  }
}

if (!existsSync(EXPECTED.apkPath)) {
  throw new Error(`APK no encontrado en ${EXPECTED.apkPath}. Ejecuta primero npm run build:field-update:android`);
}

if (!existsSync(EXPECTED.metadataPath)) {
  throw new Error(`Metadata no encontrada en ${EXPECTED.metadataPath}.`);
}

const aapt = findAndroidTool('aapt');
const apksigner = findAndroidTool('apksigner');

const badging = execFileSync(aapt, ['dump', 'badging', EXPECTED.apkPath], { encoding: 'utf8' });
const packageInfo = parseBadging(badging);
const signerOutput = execFileSync(apksigner, ['verify', '--print-certs', EXPECTED.apkPath], { encoding: 'utf8' });
const certSha256 = parseSigner(signerOutput);
const metadata = JSON.parse(readFileSync(EXPECTED.metadataPath, 'utf8'));
const outputElement = metadata.elements?.[0] ?? {};
const apkSha256 = sha256File(EXPECTED.apkPath);

assertEqual(packageInfo.applicationId, EXPECTED.applicationId, 'applicationId');
assertEqual(packageInfo.versionCode, EXPECTED.versionCode, 'versionCode');
assertEqual(packageInfo.versionName, EXPECTED.versionName, 'versionName');
assertEqual(String(outputElement.versionCode), EXPECTED.versionCode, 'output-metadata versionCode');
assertEqual(String(outputElement.versionName), EXPECTED.versionName, 'output-metadata versionName');
assertEqual(certSha256, EXPECTED.certSha256, 'certificate SHA-256');

console.log(JSON.stringify({
  apk: EXPECTED.apkPath,
  apkSha256,
  applicationId: packageInfo.applicationId,
  versionCode: packageInfo.versionCode,
  versionName: packageInfo.versionName,
  certSha256,
}, null, 2));
