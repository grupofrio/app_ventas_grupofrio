import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selfTestPath = 'tests/noPrivilegedOdooClient.test.mjs';
const appConfigInputs = [
  'config',
  'app.json',
  'eas.json',
  'app.config.js',
  'app.config.cjs',
  'app.config.mjs',
  'app.config.ts',
];
const supportedLockfiles = ['package-lock.json', 'npm-shrinkwrap.json'];
const releaseInputs = [
  'app',
  'src',
  'assets',
  ...appConfigInputs,
  'ios',
  'android',
  'package.json',
  ...supportedLockfiles,
];

const forbidden = [
  /setServiceCredentials\s*\(/,
  /\/web\/session\/authenticate/,
  /\/web\/dataset\/call_kw/,
  /\bexecute_kw\b/,
  /(?:from|import\()\s*['\"][^'\"]*odoo(?:Session|Rpc)/,
  /import\s+(?:\(\s*)?['\"][^'\"]*odoo(?:Session|Rpc)/,
  /(?:login|user(?:name)?|password|passwd)\s*:\s*['\"][^'\"]{8,}['\"]/i,
  /['\"][^'\"\n]+@[^'\"\n]+\.[a-z]{2,}['\"]\s*,\s*['\"][^'\"\n]{8,}['\"]/i,
];

const indicatorNames = [
  'set-service-credentials',
  'session-authenticate',
  'dataset-call-kw',
  'execute-kw',
  'odoo-session-or-rpc-import',
  'odoo-session-or-rpc-import-with-spacing',
  'credential-like-object',
  'credential-like-pair',
];

const excludedDirectoryNames = new Set([
  '.git',
  'node_modules',
  'Pods',
  'vendor',
  'build',
  'DerivedData',
]);

function isExcluded(path) {
  const segments = path.split('/');
  return segments.some((segment) =>
    excludedDirectoryNames.has(segment) || segment.endsWith('.app') || segment.endsWith('.ipa'),
  );
}

function versionedReleaseFiles() {
  const output = execFileSync('git', ['ls-files', '-z', '--', ...releaseInputs], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  return new Set(output.split('\0').filter(Boolean));
}

function collectFiles(rootPath, versionedFiles, files = []) {
  const relativePath = relative(repositoryRoot, rootPath).replaceAll('\\', '/');

  if (relativePath === selfTestPath || isExcluded(relativePath)) {
    return files;
  }

  const stats = statSync(rootPath);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(rootPath)) {
      collectFiles(resolve(rootPath, entry), versionedFiles, files);
    }
  } else if (stats.isFile() && versionedFiles.has(relativePath)) {
    files.push(relativePath);
  }

  return files;
}

function isCredentialContext(key) {
  return /(?:credential|auth|login|user(?:name)?|password|passwd)/i.test(key);
}

function isEmailLike(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value);
}

function isSecretLike(value) {
  return typeof value === 'string' && value.length >= 8 && !isEmailLike(value);
}

function containsCredentialPair(value, contextKey = '') {
  if (Array.isArray(value)) {
    if (
      isCredentialContext(contextKey) &&
      value.some(isEmailLike) &&
      value.some(isSecretLike)
    ) {
      return true;
    }

    return value.some((item) => containsCredentialPair(item, contextKey));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  const entries = Object.entries(value);
  const scalarValues = entries.map(([, item]) => item);
  if (
    (isCredentialContext(contextKey) || entries.some(([key]) => isCredentialContext(key))) &&
    scalarValues.some(isEmailLike) &&
    scalarValues.some(isSecretLike)
  ) {
    return true;
  }

  return entries.some(([key, item]) => containsCredentialPair(item, key));
}

function hasLockfileCredentialPair(contents) {
  try {
    return containsCredentialPair(JSON.parse(contents));
  } catch {
    return true;
  }
}

function assertReleaseScanPolicy() {
  assert.deepEqual(appConfigInputs, [
    'config',
    'app.json',
    'eas.json',
    'app.config.js',
    'app.config.cjs',
    'app.config.mjs',
    'app.config.ts',
  ]);
  assert.deepEqual(supportedLockfiles, ['package-lock.json', 'npm-shrinkwrap.json']);
  assert.equal(releaseInputs.includes('package-lock.json'), true);
  assert.equal(releaseInputs.includes(selfTestPath), false);
  assert.equal(excludedDirectoryNames.has('vendor'), true);
}

test('lockfile credential pairs require an explicit credential context', () => {
  const pairIndicator = forbidden[indicatorNames.indexOf('credential-like-pair')];
  const fixtureEmail = 'fixture-user@example.invalid';
  const fixtureValue = 'fixture-password-not-real';
  const dependencyMetadata = JSON.stringify({ maintainers: [fixtureEmail, fixtureValue] });
  const explicitCredentials = JSON.stringify({ credentials: [fixtureEmail, fixtureValue] });

  assert.equal(pairIndicator.test(dependencyMetadata), true);
  assert.equal(hasLockfileCredentialPair(dependencyMetadata), false);
  assert.equal(pairIndicator.test(explicitCredentials), true);
  assert.equal(hasLockfileCredentialPair(explicitCredentials), true);
});

test('release inputs contain no privileged Odoo client indicators', () => {
  assertReleaseScanPolicy();
  const versionedFiles = versionedReleaseFiles();
  const files = releaseInputs.flatMap((input) => {
    const inputPath = resolve(repositoryRoot, input);
    return existsSync(inputPath) ? collectFiles(inputPath, versionedFiles) : [];
  });
  const violations = [];

  for (const file of files) {
    const contents = readFileSync(resolve(repositoryRoot, file), 'utf8');

    forbidden.forEach((indicator, index) => {
      const isCredentialPair = indicatorNames[index] === 'credential-like-pair';
      const lockfileMatch = supportedLockfiles.includes(file) && isCredentialPair;
      const hasViolation = lockfileMatch
        ? hasLockfileCredentialPair(contents)
        : indicator.test(contents);

      if (hasViolation) {
        violations.push(`${file} [${index}:${indicatorNames[index]}]`);
      }
    });
  }

  if (violations.length > 0) {
    assert.fail(violations.join(', '));
  }
});
