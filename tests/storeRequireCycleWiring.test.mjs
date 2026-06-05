import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const authStore = readFileSync(resolve(REPO_ROOT, 'src/stores/useAuthStore.ts'), 'utf8');

assert.doesNotMatch(
  authStore,
  /import\s+\{\s*useRouteStore\s*\}\s+from\s+['"]\.\/useRouteStore['"]/,
  'useAuthStore must not statically import useRouteStore; that closes Auth -> Route -> Sync -> Product -> Auth',
);
assert.match(
  authStore,
  /await import\(['"]\.\/useRouteStore['"]\)/,
  'route cache reset should use a deferred import so logout/login can still reset route state without a module load cycle',
);

console.log('store require-cycle wiring tests: ok');
