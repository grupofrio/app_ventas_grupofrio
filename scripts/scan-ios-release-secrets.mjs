import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const sourceIndicators = [
  '/web/session/authenticate',
  '/web/dataset/call_kw',
  'execute_kw',
  'setServiceCredentials',
];
const secretEnvNames = ['KOLD_REVOKED_ODOO_LOGIN', 'KOLD_REVOKED_ODOO_PASSWORD'];

function isIpaPath(ipaPath) {
  return typeof ipaPath === 'string' && ipaPath.toLowerCase().endsWith('.ipa');
}

function collectAppFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      collectAppFiles(entryPath, files);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function containsSourceIndicator(contents) {
  const text = contents.toString('utf8');
  return sourceIndicators.some((indicator) => text.includes(indicator));
}

function containsRevokedSecret(contents, secretValues) {
  return secretValues.some((secretValue) => contents.includes(secretValue));
}

function scanIpa(ipaPath) {
  if (process.argv.length !== 3 || !isIpaPath(ipaPath)) {
    throw new Error('Expected one .ipa file path');
  }

  const resolvedIpaPath = resolve(ipaPath);
  let temporaryDirectory;

  try {
    let ipaIsFile = false;
    try {
      ipaIsFile = statSync(resolvedIpaPath).isFile();
    } catch {
      throw new Error('Unable to read IPA');
    }

    if (!ipaIsFile) {
      throw new Error('Unable to read IPA');
    }

    temporaryDirectory = mkdtempSync(join(tmpdir(), 'app-ventas-ipa-'));

    try {
      execFileSync('unzip', ['-qq', resolvedIpaPath, '-d', temporaryDirectory], {
        stdio: 'pipe',
      });
    } catch {
      throw new Error('Unable to extract IPA');
    }

    const payloadDirectory = join(temporaryDirectory, 'Payload');
    let appDirectories;
    try {
      appDirectories = readdirSync(payloadDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
        .map((entry) => join(payloadDirectory, entry.name));
    } catch {
      throw new Error('IPA contains no application payload');
    }

    if (appDirectories.length === 0) {
      throw new Error('IPA contains no application payload');
    }

    const secretValues = secretEnvNames
      .map((name) => process.env[name])
      .filter((value) => typeof value === 'string' && value.length > 0);
    const files = appDirectories.flatMap((appDirectory) => collectAppFiles(appDirectory));

    for (const file of files) {
      const contents = readFileSync(file);

      if (containsSourceIndicator(contents)) {
        throw new Error('IPA contains a prohibited source indicator');
      }

      if (containsRevokedSecret(contents, secretValues)) {
        throw new Error('IPA contains a revoked-secret indicator');
      }
    }

    if (process.env.CI && secretValues.length !== secretEnvNames.length) {
      throw new Error('IPA scan requires revoked-secret environment variables in CI');
    }
  } finally {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

try {
  scanIpa(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
