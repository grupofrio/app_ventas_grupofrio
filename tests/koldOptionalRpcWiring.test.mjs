import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

function read(path) {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

const api = read('src/services/api.ts');
const odooRpc = read('src/services/odooRpc.ts');

assert.match(
  api,
  /allowFunctionalErrorResult\?: boolean/,
  'postRpc must expose an explicit opt-in for optional callers that need raw functional-error envelopes',
);
assert.match(
  api,
  /const errMsg = odooErrMsg \|\| \(options\.allowFunctionalErrorResult\s*\?\s*null\s*:\s*functionalErr\)/,
  'postRpc must keep functional-error throwing as the default behavior',
);
assert.match(
  odooRpc,
  /koldRead[\s\S]*postRpc<any>\([\s\S]*allowFunctionalErrorResult: true/,
  'koldRead must opt into raw functional-error envelopes so optional ACL failures become null, not logged http_error exceptions',
);

console.log('kold optional rpc wiring tests: ok');
