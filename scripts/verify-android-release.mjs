import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const EXPECTED = {
  apkPath: process.env.APK_PATH
    ? path.resolve(process.env.APK_PATH)
    : path.resolve('android/app/build/outputs/apk/release/app-release.apk'),
  applicationId: 'mx.grupofrio.koldfield',
  versionCode: '6',
  versionName: '1.4.2',
  certSha256: 'c18ac1fab03b839e4e4c25fcedd99d59e16927b593a0e292cfd880287bd6f08c',
};

function findAndroidTool(toolName) {
  const sdkRoot = process.env.ANDROID_SDK_ROOT
    || process.env.ANDROID_HOME
    || path.join(os.homedir(), 'Library/Android/sdk');
  const buildToolsDir = path.join(sdkRoot, 'build-tools');

  if (!existsSync(buildToolsDir)) {
    throw new Error(`Android build-tools no encontrado en ${buildToolsDir}`);
  }

  const executableName = process.platform === 'win32'
    ? toolName === 'apksigner' ? 'apksigner.bat' : `${toolName}.exe`
    : toolName;
  const versions = readdirSync(buildToolsDir)
    .filter((entry) => existsSync(path.join(buildToolsDir, entry, executableName)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (versions.length === 0) {
    throw new Error(`No se encontró ${toolName} dentro de ${buildToolsDir}`);
  }

  return path.join(buildToolsDir, versions.at(-1), executableName);
}

function runAndroidTool(toolPath, args) {
  if (process.platform === 'win32' && toolPath.endsWith('.bat')) {
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'call', toolPath, ...args], {
      encoding: 'utf8',
    });
  }

  return execFileSync(toolPath, args, { encoding: 'utf8' });
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
  const match = output.match(/(?:Signer #1|V2 Signer): certificate SHA-256 digest: ([0-9a-f]+)/i);

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

const aapt = findAndroidTool('aapt');
const apksigner = findAndroidTool('apksigner');

const badging = runAndroidTool(aapt, ['dump', 'badging', EXPECTED.apkPath]);
const packageInfo = parseBadging(badging);
const signerOutput = runAndroidTool(apksigner, ['verify', '--print-certs', EXPECTED.apkPath]);
const certSha256 = parseSigner(signerOutput);
const apkSha256 = sha256File(EXPECTED.apkPath);

assertEqual(packageInfo.applicationId, EXPECTED.applicationId, 'applicationId');
assertEqual(packageInfo.versionCode, EXPECTED.versionCode, 'versionCode');
assertEqual(packageInfo.versionName, EXPECTED.versionName, 'versionName');
assertEqual(certSha256, EXPECTED.certSha256, 'certificate SHA-256');

console.log(JSON.stringify({
  apk: EXPECTED.apkPath,
  apkSha256,
  applicationId: packageInfo.applicationId,
  versionCode: packageInfo.versionCode,
  versionName: packageInfo.versionName,
  certSha256,
}, null, 2));
