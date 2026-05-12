import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

function extractFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} debe existir`);

  let parenDepth = 0;
  let open = -1;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;
    if (char === '{' && parenDepth === 0) {
      open = i;
      break;
    }
  }
  assert.notEqual(open, -1, `${name} debe tener cuerpo`);

  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`No se pudo extraer ${name}`);
}

function testPricelistUsesSecureBackendPricingEndpoint() {
  const pricelist = readFileSync(resolve(REPO_ROOT, 'src/services/pricelist.ts'), 'utf8');
  const body = extractFunctionBody(pricelist, 'fetchServerSidePrices');

  assert.match(
    body,
    /pricing\/by_partner/,
    'fetchServerSidePrices debe consultar el endpoint seguro pricing/by_partner',
  );
  assert.match(
    body,
    /postRest<|postRest\(/,
    'fetchServerSidePrices debe usar postRest con tokens de empleado, no odooSession',
  );
  assert.doesNotMatch(
    body,
    /return\s+null\s*;\s*$/,
    'fetchServerSidePrices no debe ser un stub que siempre cae al fallback Odoo directo',
  );
}

function main() {
  testPricelistUsesSecureBackendPricingEndpoint();
  console.log('pricelist server endpoint tests: ok');
}

main();
