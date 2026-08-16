import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('src/services/api.ts'), 'utf8');

assert.match(
  source,
  /headers(?:\[['"]Authorization['"]\]|\.Authorization)\s*=\s*`Bearer \$\{[^}]+\}`/,
  'employee REST transport must send the employee token as Authorization: Bearer',
);
assert.doesNotMatch(
  source,
  /headers\[['"]X-GF-Employee-Token['"]\]/,
  'employee REST transport must not keep the legacy X-GF-Employee-Token header',
);
assert.doesNotMatch(
  source,
  /headers\[['"]X-GF-Token['"]\]/,
  'employee REST transport must not keep the legacy X-GF-Token header',
);

console.log('employee bearer transport tests: ok');
