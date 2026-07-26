import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gfLogistics = readFileSync(resolve('src/services/gfLogistics.ts'), 'utf8');
const createSaleMatch = gfLogistics.match(
  /export async function createSale\([\s\S]*?\n}\n\nexport async function acceptRouteLoad/,
);

assert.ok(createSaleMatch, 'createSale source block must remain directly before acceptRouteLoad');

const createSale = createSaleMatch[0].replace(/\n\nexport async function acceptRouteLoad$/, '');

assert.match(
  gfLogistics,
  /import\s+\{\s*validateSaleCreateResult\s*}\s+from\s+'\.\/saleCreateResult';/,
  'gfLogistics must import validateSaleCreateResult',
);
assert.match(
  createSale,
  /postRest<unknown>\(\s*`\$\{GF_BASE}\/sales\/create`,\s*body,?\s*\)/,
  'createSale must retain the real REST envelope for validation',
);
assert.match(
  createSale,
  /const expectedOperationId = typeof body\.operation_id === 'string' \? body\.operation_id : '';/,
  'createSale must derive the expected operation id from the submitted body',
);
assert.match(
  createSale,
  /return validateSaleCreateResult\(result, expectedOperationId\);/,
  'createSale must return validated response data matched to the submitted operation id',
);
assert.doesNotMatch(createSale, /return true;/, 'createSale must not discard the validated response data');
assert.equal(
  [...gfLogistics.matchAll(/validateSaleCreateResult\(result, expectedOperationId\)/g)].length,
  1,
  'response validation must be wired only into createSale',
);
assert.match(
  gfLogistics,
  /export async function createPayment\([\s\S]*?postRest<\{ success\?: boolean }>\([\s\S]*?`\$\{GF_BASE}\/payments\/create`[\s\S]*?return !!result;[\s\S]*?\n}/,
  'createPayment must keep its existing wrapper contract',
);

console.log('sale create contract wiring tests: ok');
