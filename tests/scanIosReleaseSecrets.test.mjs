import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { scanIpa } from '../scripts/scan-ios-release-secrets.mjs';

const DIRECTORY_MODE = 0o040755;
const FILE_MODE = 0o100644;
const SYMLINK_MODE = 0o120777;
const fakeRevokedValue = 'fixture-revoked-value-not-real';

function crc32(contents) {
  let crc = 0xffffffff;

  for (const byte of contents) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredIpa(directory, name, entries) {
  const localEntries = [];
  const centralEntries = [];
  let offset = 0;

  for (const entry of entries) {
    const entryName = Buffer.from(entry.name, 'utf8');
    const contents = Buffer.from(entry.contents ?? '');
    const checksum = crc32(contents);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(contents.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(entryName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localEntries.push(localHeader, entryName, contents);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(contents.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(entryName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((entry.mode ?? FILE_MODE) << 16 >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralEntries.push(centralHeader, entryName);
    offset += localHeader.length + entryName.length + contents.length;
  }

  const centralDirectory = Buffer.concat(centralEntries);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(centralDirectory.length, 12);
  footer.writeUInt32LE(offset, 16);

  const ipaPath = join(directory, `${name}.ipa`);
  writeFileSync(ipaPath, Buffer.concat([...localEntries, centralDirectory, footer]));
  return ipaPath;
}

function applicationEntries(contents = 'safe asset') {
  return [
    { name: 'Payload/', mode: DIRECTORY_MODE },
    { name: 'Payload/Probe.app/', mode: DIRECTORY_MODE },
    { name: 'Payload/Probe.app/asset.bin', contents, mode: FILE_MODE },
  ];
}

function withFixtureDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'ipa-scanner-test-'));

  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertExtractorCleanup(directory) {
  const extractionDirectories = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('app-ventas-ipa-'));

  assert.equal(extractionDirectories.length, 0);
}

function assertGenericError(expectedMessage, forbiddenValue) {
  return (error) =>
    error instanceof Error &&
    error.message === expectedMessage &&
    (!forbiddenValue || !error.message.includes(forbiddenValue));
}

test('scanner accepts a clean IPA and removes its extractor directory', () => {
  withFixtureDirectory((directory) => {
    const ipaPath = createStoredIpa(directory, 'clean', applicationEntries());

    scanIpa(ipaPath, { environment: {}, temporaryParent: directory });

    assertExtractorCleanup(directory);
  });
});

test('scanner blocks a source indicator without exposing fixture contents', () => {
  withFixtureDirectory((directory) => {
    const ipaPath = createStoredIpa(
      directory,
      'source-indicator',
      applicationEntries('/web/session/authenticate'),
    );

    assert.throws(
      () => scanIpa(ipaPath, { environment: {}, temporaryParent: directory }),
      assertGenericError('IPA contains a prohibited source indicator'),
    );
    assertExtractorCleanup(directory);
  });
});

test('scanner blocks a revoked-secret sequence without exposing fixture contents', () => {
  withFixtureDirectory((directory) => {
    const ipaPath = createStoredIpa(directory, 'revoked-secret', applicationEntries(fakeRevokedValue));

    assert.throws(
      () =>
        scanIpa(ipaPath, {
          environment: {
            KOLD_REVOKED_ODOO_LOGIN: fakeRevokedValue,
            KOLD_REVOKED_ODOO_PASSWORD: 'fixture-password-not-real',
          },
          temporaryParent: directory,
        }),
      assertGenericError('IPA contains a revoked-secret indicator', fakeRevokedValue),
    );
    assertExtractorCleanup(directory);
  });
});

test('scanner requires revoked-secret variables in CI', () => {
  withFixtureDirectory((directory) => {
    const ipaPath = createStoredIpa(directory, 'ci-missing-env', applicationEntries());

    assert.throws(
      () => scanIpa(ipaPath, { environment: { CI: '1' }, temporaryParent: directory }),
      assertGenericError('IPA scan requires revoked-secret environment variables in CI'),
    );
    assertExtractorCleanup(directory);
  });
});

test('scanner rejects a malformed archive before extraction', () => {
  withFixtureDirectory((directory) => {
    const ipaPath = join(directory, 'malformed.ipa');
    writeFileSync(ipaPath, 'not a zip archive');

    assert.throws(
      () => scanIpa(ipaPath, { environment: {}, temporaryParent: directory }),
      assertGenericError('IPA archive is malformed or unsafe'),
    );
    assertExtractorCleanup(directory);
  });
});

test('scanner rejects traversal entries before extraction', () => {
  withFixtureDirectory((directory) => {
    const ipaPath = createStoredIpa(directory, 'traversal', [
      ...applicationEntries(),
      { name: 'Payload/Probe.app/../../outside.bin', contents: 'unsafe', mode: FILE_MODE },
    ]);

    assert.throws(
      () => scanIpa(ipaPath, { environment: {}, temporaryParent: directory }),
      assertGenericError('IPA archive is malformed or unsafe'),
    );
    assertExtractorCleanup(directory);
  });
});

test('scanner rejects symbolic links before extraction', () => {
  withFixtureDirectory((directory) => {
    const ipaPath = createStoredIpa(directory, 'symlink', [
      ...applicationEntries(),
      { name: 'Payload/Probe.app/unsafe-link', contents: 'target', mode: SYMLINK_MODE },
    ]);

    assert.throws(
      () => scanIpa(ipaPath, { environment: {}, temporaryParent: directory }),
      assertGenericError('IPA archive is malformed or unsafe'),
    );
    assertExtractorCleanup(directory);
  });
});
