#!/usr/bin/env node
// Cross-platform test runner for kold-field.
//
// Why this exists:
//   - `node --test <dir>` only auto-discovers .test.{js,cjs,mjs}, not .test.ts
//   - Shell glob expansion of "tests/*.test.{ts,mjs}" is not portable to
//     Windows cmd.exe / PowerShell
//
// What it does:
//   - Finds tests/*.test.{ts,mjs} via fs.readdirSync (portable)
//   - Spawns a single `node --test --experimental-strip-types <files...>`
//   - Forwards exit code so npm test fails when any test fails
//
// Requirements:
//   - Node >= 22.6 (for --experimental-strip-types of .test.ts files)

import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = join(REPO_ROOT, 'tests');
const PATTERN = /\.test\.(ts|mjs)$/;

const files = readdirSync(TEST_DIR)
  .filter((name) => PATTERN.test(name))
  .map((name) => join(TEST_DIR, name))
  .sort();

if (files.length === 0) {
  console.error(`No test files matching ${PATTERN} in ${TEST_DIR}`);
  process.exit(1);
}

console.log(`Running ${files.length} test files…`);

// Windows limits the total command-line length passed to CreateProcess. Keep
// the regular single-process run elsewhere, but split the file list on Windows
// so a growing suite cannot fail before Node's test runner even starts.
const batchSize = process.platform === 'win32' ? 20 : files.length;
const batches = Array.from(
  { length: Math.ceil(files.length / batchSize) },
  (_, index) => files.slice(index * batchSize, (index + 1) * batchSize),
);

function runBatch(index) {
  if (index >= batches.length) {
    process.exit(0);
  }

  if (batches.length > 1) {
    console.log(`Running batch ${index + 1}/${batches.length}…`);
  }

  const args = ['--test', '--experimental-strip-types', ...batches[index]];
  const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: REPO_ROOT });
  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
  child.on('exit', (code) => {
    if (code !== 0) {
      process.exit(code ?? 1);
    }
    runBatch(index + 1);
  });
}

runBatch(0);
