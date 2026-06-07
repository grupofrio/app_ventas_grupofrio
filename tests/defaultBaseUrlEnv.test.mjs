import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/api.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /EXPO_PUBLIC_KF_DEFAULT_BASE_URL/,
  'api.ts must read EXPO_PUBLIC_KF_DEFAULT_BASE_URL for staging/device smoke builds',
);

assert.match(
  source,
  /export const DEFAULT_BASE_URL\s*=\s*PUBLIC_DEFAULT_BASE_URL\s*\|\|\s*'https:\/\/grupofrio\.odoo\.com'/,
  'DEFAULT_BASE_URL must fall back to production only when the public env var is absent',
);

console.log('default base url env tests: ok');
