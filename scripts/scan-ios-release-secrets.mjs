import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const sourceIndicators = [
  '/web/session/authenticate',
  '/web/dataset/call_kw',
  'execute_kw',
  'setServiceCredentials',
];
const secretEnvNames = ['KOLD_REVOKED_ODOO_LOGIN', 'KOLD_REVOKED_ODOO_PASSWORD'];
const maxArchiveBytes = 256 * 1024 * 1024;
const maxArchiveEntries = 10_000;
const maxUncompressedBytes = 512 * 1024 * 1024;
const maxEntryUncompressedBytes = 128 * 1024 * 1024;
const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const regularFileMode = 0o100000;
const directoryMode = 0o040000;
const fileTypeMask = 0o170000;
const malformedArchiveMessage = 'IPA archive is malformed or unsafe';

function malformedArchiveError() {
  return new Error(malformedArchiveMessage);
}

function isIpaPath(ipaPath) {
  return typeof ipaPath === 'string' && ipaPath.toLowerCase().endsWith('.ipa');
}

function assertSafeEntryName(entryName) {
  if (
    entryName.length === 0 ||
    entryName.includes('\0') ||
    entryName.includes('\\') ||
    entryName.startsWith('/') ||
    /^[A-Za-z]:/.test(entryName)
  ) {
    throw malformedArchiveError();
  }

  const segments = entryName.split('/');
  if (
    segments[0] === '' ||
    segments.some((segment, index) =>
      segment === '.' ||
      segment === '..' ||
      (segment === '' && index !== segments.length - 1),
    )
  ) {
    throw malformedArchiveError();
  }
}

function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - 0xffff - 22);

  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === endOfCentralDirectorySignature) {
      return offset;
    }
  }

  throw malformedArchiveError();
}

function parseCentralDirectory(archive) {
  const endOffset = findEndOfCentralDirectory(archive);

  if (endOffset + 22 > archive.length) {
    throw malformedArchiveError();
  }

  const diskNumber = archive.readUInt16LE(endOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(endOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8);
  const totalEntries = archive.readUInt16LE(endOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0xffff ||
    totalEntries > maxArchiveEntries ||
    centralDirectoryEnd > endOffset
  ) {
    throw malformedArchiveError();
  }

  const entries = [];
  let cursor = centralDirectoryOffset;
  let totalUncompressedSize = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralDirectoryEnd || archive.readUInt32LE(cursor) !== centralDirectorySignature) {
      throw malformedArchiveError();
    }

    const flags = archive.readUInt16LE(cursor + 8);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;

    if (entryEnd > centralDirectoryEnd || flags & 0x1 || uncompressedSize > maxEntryUncompressedBytes) {
      throw malformedArchiveError();
    }

    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > maxUncompressedBytes || compressedSize > maxArchiveBytes) {
      throw malformedArchiveError();
    }

    const rawName = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const entryName = rawName.toString('utf8');
    if (!Buffer.from(entryName, 'utf8').equals(rawName)) {
      throw malformedArchiveError();
    }

    assertSafeEntryName(entryName);

    const unixMode = externalAttributes >>> 16;
    const entryType = unixMode & fileTypeMask;
    if (
      (unixMode !== 0 && entryType !== regularFileMode && entryType !== directoryMode) ||
      (entryName.endsWith('/') && unixMode !== 0 && entryType !== directoryMode) ||
      (!entryName.endsWith('/') && unixMode !== 0 && entryType !== regularFileMode)
    ) {
      throw malformedArchiveError();
    }

    entries.push(entryName);
    cursor = entryEnd;
  }

  if (cursor !== centralDirectoryEnd || new Set(entries).size !== entries.length) {
    throw malformedArchiveError();
  }

  return entries;
}

function preflightArchive(ipaPath, archiveSize) {
  if (archiveSize > maxArchiveBytes) {
    throw malformedArchiveError();
  }

  try {
    const listedEntries = execFileSync('unzip', ['-Z1', ipaPath], {
      encoding: 'utf8',
      maxBuffer: maxArchiveEntries * 1024,
      stdio: 'pipe',
    })
      .replaceAll('\r', '')
      .split('\n')
      .filter(Boolean);
    const centralEntries = parseCentralDirectory(readFileSync(ipaPath));

    if (
      listedEntries.length === 0 ||
      listedEntries.length !== centralEntries.length ||
      new Set(listedEntries).size !== listedEntries.length ||
      listedEntries.some((entryName) => !centralEntries.includes(entryName))
    ) {
      throw malformedArchiveError();
    }
  } catch (error) {
    if (error instanceof Error && error.message === malformedArchiveMessage) {
      throw error;
    }

    throw malformedArchiveError();
  }
}

function collectAppFiles(directory, files = []) {
  let entries;

  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    throw new Error('Unable to scan IPA');
  }

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw malformedArchiveError();
    }

    if (entry.isDirectory()) {
      collectAppFiles(entryPath, files);
    } else {
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

function revokedSecretValues(environment) {
  return secretEnvNames
    .map((name) => environment[name])
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function readIpaFile(ipaPath) {
  try {
    if (!statSync(ipaPath).isFile()) {
      throw new Error('not a file');
    }
  } catch {
    throw new Error('Unable to read IPA');
  }
}

export function scanIpa(ipaPath, { environment = process.env, temporaryParent = tmpdir() } = {}) {
  if (!isIpaPath(ipaPath)) {
    throw new Error('Expected one .ipa file path');
  }

  const resolvedIpaPath = resolve(ipaPath);
  readIpaFile(resolvedIpaPath);

  let archiveSize;
  try {
    archiveSize = statSync(resolvedIpaPath).size;
  } catch {
    throw new Error('Unable to read IPA');
  }

  preflightArchive(resolvedIpaPath, archiveSize);

  let temporaryDirectory;
  try {
    try {
      temporaryDirectory = mkdtempSync(join(temporaryParent, 'app-ventas-ipa-'));
    } catch {
      throw new Error('Unable to prepare IPA scan');
    }

    try {
      execFileSync('unzip', ['-qq', '-n', resolvedIpaPath, '-d', temporaryDirectory], {
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

    const secretValues = revokedSecretValues(environment);
    const files = appDirectories.flatMap((appDirectory) => collectAppFiles(appDirectory));

    for (const file of files) {
      let contents;
      try {
        contents = readFileSync(file);
      } catch {
        throw new Error('Unable to scan IPA');
      }

      if (containsSourceIndicator(contents)) {
        throw new Error('IPA contains a prohibited source indicator');
      }

      if (containsRevokedSecret(contents, secretValues)) {
        throw new Error('IPA contains a revoked-secret indicator');
      }
    }

    if (
      environment.CI &&
      secretEnvNames.some((name) => typeof environment[name] !== 'string' || environment[name].length === 0)
    ) {
      throw new Error('IPA scan requires revoked-secret environment variables in CI');
    }
  } finally {
    if (temporaryDirectory) {
      try {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      } catch {
        // The scanner never reports cleanup paths or archive contents.
      }
    }
  }
}

function runCli() {
  if (process.argv.length !== 3) {
    throw new Error('Expected one .ipa file path');
  }

  scanIpa(process.argv[2]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
