import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

function main() {
  // Normalize CRLF→LF so the source-text regexes below match regardless of the
  // checkout's line endings (Windows autocrlf produced \r\n, breaking \n}\n\n).
  const api = readFileSync(resolve(REPO_ROOT, 'src/services/api.ts'), 'utf8').replace(/\r\n/g, '\n');

  assert.match(
    api,
    /DEFAULT_FETCH_TIMEOUT_MS\s*=\s*45_000/,
    'REST fetch requests must have a 45s default timeout instead of waiting for Odoo.sh indefinitely',
  );
  assert.match(
    api,
    /AbortController/,
    'REST fetch requests must use AbortController to cancel hung network calls',
  );
  assert.match(
    api,
    /fetchWithTimeout/,
    'HTTP helpers must centralize timeout handling so corte/liquidation and GPS sync share the same safety net',
  );

  const postRestBlock = api.match(/export async function postRest[\s\S]*?\n}\n\n\/\*\*/)?.[0] ?? '';
  assert.match(
    postRestBlock,
    /fetchWithTimeout\(absoluteUrl/,
    'postRest must use the timeout wrapper',
  );
  assert.doesNotMatch(
    postRestBlock,
    /await fetch\(absoluteUrl/,
    'postRest must not call fetch directly without a timeout',
  );

  console.log('http timeout tests: ok');
}

main();
