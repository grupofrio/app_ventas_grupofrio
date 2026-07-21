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
    /import\s*{[^}]*makeApiResponseError,[^}]*makeApiTransportError,[^}]*}\s*from\s*['"]\.\/apiRequestError['"];?/,
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
    postRestBlock,
    /let responseStatus:\s*number \| undefined;/,
    'postRest must track when fetch has produced a response',
  );
  assert.match(
    postRestBlock,
    /const response = await fetchWithTimeout\([\s\S]*?responseStatus = response\.status;/,
    'postRest must capture response status before reading or parsing the response body',
  );
  assert.match(
    outerCatch,
    /getApiErrorCode\(error\) === 'invalid_response'[\s\S]*?makeApiTransportError\(error\)[\s\S]*?makeApiResponseError\(error, 'Error de solicitud', responseStatus\)/,
    'the outer catch must preserve invalid responses and distinguish transport from parsed response failures',
  );
  assert.match(postRestBlock, /readPostRestResponseText\(response\)/);
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

test('postRpc retains its legacy message-only error handling', () => {
  const api = readFileSync(resolve(REPO_ROOT, 'src/services/api.ts'), 'utf8').replace(/\r\n/g, '\n');
  const postRpcBlock = api.match(
    /export async function postRpc[\s\S]*?(?=\n\/\*\*\n \* POST to the legacy \/jsonrpc endpoint)/,
  )?.[0] ?? '';

  assert.notEqual(postRpcBlock, '', 'postRpc block must be isolated for policy-scope assertions');
  assert.match(
    postRpcBlock,
    /throw makeLoggedHttpError\(errMsg\);/,
    'postRpc response failures must keep existing logged HTTP error handling',
  );
  assert.match(
    postRpcBlock,
    /catch \(error\) \{[\s\S]*?throw error;/,
    'postRpc transport failures must continue to rethrow the original error',
  );
  assert.doesNotMatch(
    postRpcBlock,
    /makeApiResponseError|makeApiTransportError|responseStatus|resultError/,
    'structured REST request metadata must not broaden to RPC calls',
  );
});
