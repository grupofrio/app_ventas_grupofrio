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
// This migration gate is deliberately run by `npm run test:security` while
// legacy privileged paths are removed, so the normal behavioral suite stays green.
const DEDICATED_SECURITY_TESTS = new Set(['noPrivilegedOdooClient.test.mjs']);

const files = readdirSync(TEST_DIR)
  .filter((name) => PATTERN.test(name) && !DEDICATED_SECURITY_TESTS.has(name))
  .map((name) => join(TEST_DIR, name))
  .sort();

if (files.length === 0) {
  console.error(`No test files matching ${PATTERN} in ${TEST_DIR}`);
  process.exit(1);
}

console.log(`Running ${files.length} test files…`);

const args = ['--test', '--experimental-strip-types', ...files];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: REPO_ROOT });
child.on('exit', (code) => process.exit(code ?? 1));
