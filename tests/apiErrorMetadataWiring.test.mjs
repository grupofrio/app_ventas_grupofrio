import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

test('postRest preserves structured response and transport error metadata', () => {
  const api = readFileSync(resolve(REPO_ROOT, 'src/services/api.ts'), 'utf8').replace(/\r\n/g, '\n');
  const postRestBlock = api.match(
    /export async function postRest[\s\S]*?(?=\n\/\*\*\n \* GET a REST endpoint)/,
  )?.[0] ?? '';
  const outerCatch = postRestBlock.match(/\n  } catch \(error\) \{[\s\S]*?\n  }\n}\n?$/)?.[0] ?? '';

  assert.notEqual(postRestBlock, '', 'postRest block must be isolated for metadata-policy assertions');
  assert.notEqual(outerCatch, '', 'postRest outer transport catch must be isolated');
  assert.match(
    api,
    /import\s*{\s*makeApiResponseError,\s*makeApiTransportError\s*}\s*from\s*['"]\.\/apiRequestError['"];?/,
    'api.ts must import the structured request-error factories',
  );
  assert.match(
    postRestBlock,
    /let resultError:\s*unknown;/,
    'postRest must retain the actual unwrap failure alongside its display message',
  );
  assert.match(
    postRestBlock,
    /catch \(error\) \{\s*resultError = error;/,
    'postRest must save the unwrap exception before deriving its message',
  );
  assert.match(
    postRestBlock,
    /throw makeApiResponseError\(resultError, msg, response\.status\);/,
    'response failures must keep backend metadata and HTTP status',
  );
  assert.match(
    outerCatch,
    /makeApiTransportError\(error\)/,
    'failures before a response must be marked as transport failures',
  );
});

test('getRest retains its legacy message-only error handling', () => {
  const api = readFileSync(resolve(REPO_ROOT, 'src/services/api.ts'), 'utf8').replace(/\r\n/g, '\n');
  const getRestBlock = api.match(
    /export async function getRest[\s\S]*?(?=\n\/\*\*\n \* POST to an Odoo JSON-RPC endpoint)/,
  )?.[0] ?? '';

  assert.notEqual(getRestBlock, '', 'getRest block must be isolated for policy-scope assertions');
  assert.match(
    getRestBlock,
    /throw makeLoggedHttpError\(msg\);/,
    'getRest response failures must keep existing logged HTTP error handling',
  );
  assert.match(
    getRestBlock,
    /catch \(error\) \{[\s\S]*?throw error;/,
    'getRest transport failures must continue to rethrow the original error',
  );
  assert.doesNotMatch(
    getRestBlock,
    /makeApiResponseError|makeApiTransportError|resultError/,
    'structured request metadata is intentionally limited to postRest writes',
  );
});
