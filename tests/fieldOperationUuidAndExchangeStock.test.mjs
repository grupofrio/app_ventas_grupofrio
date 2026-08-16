/**
 * Contract test: mutable field operations must mint UUID v4 operation ids.
 * Prevents Date.now()/Math.random pseudo-ids that break gf PR #73 UUID gates.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const visitStore = read('src/stores/useVisitStore.ts');
assert.match(visitStore, /import \{ createUuidV4 \} from ['\"]\.\.\/utils\/clientEvent['\"]/);
assert.match(visitStore, /const opId = createUuidV4\(\);/);
assert.doesNotMatch(visitStore, /sale_\$\{Date\.now\(\)/);

for (const [file, pattern] of [
  ['app/nosale/[stopId].tsx', /function makeAttemptId\(\): string \{\s*return createUuidV4\(\);\s*\}/],
  ['app/gift/[stopId].tsx', /function makeAttemptId\(\): string \{\s*return createUuidV4\(\);\s*\}/],
  ['app/presale.tsx', /function makeOperationId\(\): string \{\s*return createUuidV4\(\);\s*\}/],
  ['app/exchange/[stopId].tsx', /function makeIdempotencyKey\(\): string \{\s*return createUuidV4\(\);\s*\}/],
  ['app/cashclose.tsx', /liquidationOpIdRef\.current = createUuidV4\(\);/],
  ['app/consignment/[stopId].tsx', /function makeOperationId\(\): string \{\s*return createUuidV4\(\);\s*\}/],
]) {
  const source = read(file);
  assert.match(source, pattern, `${file} must use createUuidV4`);
  assert.doesNotMatch(
    source,
    /\$\{Date\.now\(\)\}-\$\{Math\.random/,
    `${file} must not mint Date.now()/Math.random operation ids`,
  );
}

const exchange = read('app/exchange/[stopId].tsx');
assert.match(
  exchange,
  /applyExchangeStockViaLedger/,
  'exchange must apply inventory via ledger adapter',
);
assert.doesNotMatch(
  exchange,
  /updateLocalStock\(line\.product_id/,
  'exchange must not mutate sellable via updateLocalStock',
);
assert.doesNotMatch(
  exchange,
  /mermaPayloadLines\.forEach\(\(line\) => updateLocalStock\(line\.product_id, \+line\.qty\)\);/,
  'damaged/merma must not credit sellable local stock',
);

const gift = read('app/gift/[stopId].tsx');
assert.doesNotMatch(gift, /baja a merma de la van/);
assert.match(gift, /no es merma/);

console.log('fieldOperationUuidAndExchangeStock: ok');
