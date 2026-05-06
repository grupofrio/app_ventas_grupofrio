import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

function main() {
  const pricelist = readFileSync(resolve(REPO_ROOT, 'src/services/pricelist.ts'), 'utf8');
  const readPartnersBlock = pricelist.match(/async function readPartnersForPricelist[\s\S]*?^}/m)?.[0] ?? '';
  const resolvePartnerBlock = pricelist.match(/async function resolvePartnerPricelist[\s\S]*?^}/m)?.[0] ?? '';

  assert.doesNotMatch(
    readPartnersBlock,
    /odooRead<PartnerPricelistRecord>\(\s*'res\.partner'/,
    'Partner pricelist resolution must not fall back to /get_records for res.partner',
  );
  assert.doesNotMatch(
    resolvePartnerBlock,
    /odooRead<any>\(\s*'res\.partner'/,
    'Partner pricelist resolution must not make a second /get_records res.partner fallback',
  );

  console.log('pricelist no get_records fallback tests: ok');
}

main();
