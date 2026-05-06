import assert from 'node:assert/strict';

async function main() {
  const gpsPayload = await import(
    new URL('../src/utils/gpsPayload.ts', import.meta.url).pathname
  );

  assert.equal(
    gpsPayload.normalizeGpsTimestamp(1778019846169),
    '2026-05-05T22:24:06.169Z',
    'GPS epoch-ms timestamps must be sent to backend as ISO strings',
  );

  assert.equal(
    gpsPayload.normalizeGpsTimestamp('2026-05-05T22:24:06.169Z'),
    '2026-05-05T22:24:06.169Z',
    'GPS ISO timestamps must pass through unchanged',
  );

  assert.equal(
    gpsPayload.normalizeGpsTimestamp(undefined),
    undefined,
    'Missing GPS timestamps should remain absent so backend can default safely',
  );

  console.log('gps payload tests: ok');
}

void main();
