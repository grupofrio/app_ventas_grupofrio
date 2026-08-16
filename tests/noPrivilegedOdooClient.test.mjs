import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const FORBIDDEN_SYMBOLS = /\b(?:odooSession|odooRpc|odooRead|odooWrite|koldRead|call_kw|execute_kw|setServiceCredentials|postRpc|postJsonRpc)\b/;
const FORBIDDEN_LEGACY_URLS = /\/(?:get_records|api\/create_update|jsonrpc|web\/dataset\/call_kw)\b/;
const FORBIDDEN_DELETED_MODULE_REFERENCE = /(?:services\/(?:odooSession|odooRpc|employeeAnalytics)|\/supervisor)\b/;
const LITERAL_PASSWORD = /\b\w*(?:password|passwd|pwd)\w*\s*[:=]\s*['"`]/i;
const LEGACY_API_KEY_PERSISTENCE = /\b(?:getItemAsync|setItemAsync)\([^)]*\b(?:API_KEY|api_key|kf_api_key)\b/;
const LEGACY_LOGIN_API_KEY_BOOTSTRAP = /\bresult\?\.api_key\b/;
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
const GENERATED_DIRECTORY_NAMES = new Set(['.gradle', 'build']);

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
        if (GENERATED_DIRECTORY_NAMES.has(child.name)) continue;
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
    if (LEGACY_API_KEY_PERSISTENCE.test(source)) violations.push(`${label}: legacy API-key persistence`);
    if (LEGACY_LOGIN_API_KEY_BOOTSTRAP.test(source)) violations.push(`${label}: legacy API-key login bootstrap`);
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

test('session bootstrap depends only on the employee bearer and purges the former API-key record', () => {
  const api = readFileSync(resolve(REPO_ROOT, 'src/services/api.ts'), 'utf8');
  const hasAuthTokens = api.match(/export async function hasAuthTokens\(\)[\s\S]*?(?=\n\/\*\*)/)?.[0] ?? '';

  assert.match(hasAuthTokens, /SecureStore\.deleteItemAsync\(['"]kf_api_key['"]\)/);
  assert.match(hasAuthTokens, /SecureStore\.getItemAsync\(STORE_KEYS\.GF_TOKEN\)/);
  assert.doesNotMatch(hasAuthTokens, /(?:getItemAsync|setItemAsync)\([^)]*(?:API_KEY|api_key)/);

  const authStore = readFileSync(resolve(REPO_ROOT, 'src/stores/useAuthStore.ts'), 'utf8');
  assert.doesNotMatch(authStore, /result\?\.api_key/);
  assert.match(authStore, /setAuthTokens\(result\.gf_employee_token\)/);
});
