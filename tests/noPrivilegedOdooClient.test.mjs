import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const FORBIDDEN_SYMBOLS = /\b(?:odooSession|odooRpc|odooRead|odooWrite|koldRead|call_kw|execute_kw|setServiceCredentials)\b/;
const FORBIDDEN_LEGACY_URLS = /\/(?:get_records|api\/create_update)\b/;
const FORBIDDEN_DELETED_MODULE_REFERENCE = /(?:services\/(?:odooSession|odooRpc|employeeAnalytics)|\/supervisor)\b/;
const LITERAL_PASSWORD = /\b\w*(?:password|passwd|pwd)\w*\s*[:=]\s*['"`]/i;
const DELETED_MODULES = [
  'src/services/odooSession.ts',
  'src/services/odooRpc.ts',
  'src/services/employeeAnalytics.ts',
  'app/supervisor.tsx',
];
const RELEASE_ENTRIES = [
  'app', 'src', 'config', 'android', 'ios', 'index.ts', 'app.json', 'app.config.js',
  'app.config.ts', 'eas.json', 'package.json',
];

function collectSourceFiles(entry) {
  const absolute = resolve(REPO_ROOT, entry);
  if (!existsSync(absolute)) return [];

  const pending = [absolute];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const child of entries) {
      const childPath = join(current, child.name);
      if (child.isDirectory()) {
        pending.push(childPath);
      } else if (child.isFile()) {
        files.push(childPath);
      }
    }
  }
  return files;
}

function releaseFiles() {
  return RELEASE_ENTRIES.flatMap((entry) => {
    const absolute = resolve(REPO_ROOT, entry);
    if (!existsSync(absolute)) return [];
    return statSync(absolute).isDirectory() ? collectSourceFiles(entry) : [absolute];
  });
}

test('release code contains no privileged Odoo client, legacy endpoint, or embedded password', () => {
  const violations = [];
  for (const file of releaseFiles()) {
    const source = readFileSync(file, 'utf8');
    const label = relative(REPO_ROOT, file);
    if (FORBIDDEN_SYMBOLS.test(source)) violations.push(`${label}: privileged Odoo symbol`);
    if (FORBIDDEN_LEGACY_URLS.test(source)) violations.push(`${label}: legacy Odoo endpoint`);
    if (FORBIDDEN_DELETED_MODULE_REFERENCE.test(source)) violations.push(`${label}: deleted module reference`);
    if (LITERAL_PASSWORD.test(source)) violations.push(`${label}: literal password`);
  }

  assert.deepEqual(violations, [], 'release code must not retain privileged Odoo access');
});

test('deleted privileged modules cannot be restored or imported by release code', () => {
  for (const modulePath of DELETED_MODULES) {
    assert.equal(existsSync(resolve(REPO_ROOT, modulePath)), false, `${modulePath} must be deleted`);
  }
});

test('release guard includes Expo config and every generated native entry file', () => {
  assert.ok(RELEASE_ENTRIES.includes('config'), 'Expo config must be included in the release scan');
  assert.doesNotMatch(
    collectSourceFiles.toString(),
    /SOURCE_EXTENSIONS/,
    'native release entries must not be filtered by extension',
  );
});
