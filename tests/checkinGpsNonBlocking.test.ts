import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

function main() {
  const checkin = readFileSync(resolve(REPO_ROOT, 'app/checkin/[stopId].tsx'), 'utf8');
  const gpsMountBlock = checkin.match(/\/\/ Request GPS[\s\S]*?\}\)\(\);/)?.[0] ?? '';

  assert.doesNotMatch(
    gpsMountBlock,
    /await initializeGPS\(/,
    'Check-in screen must not block on full GPS initialization',
  );

  const gpsService = readFileSync(resolve(REPO_ROOT, 'src/services/gps.ts'), 'utf8');
  assert.match(
    gpsService,
    /GPS_POSITION_TIMEOUT_MS/,
    'Single-shot GPS reads must have a timeout',
  );
  assert.match(
    gpsService,
    /getLastKnownPositionAsync/,
    'Single-shot GPS reads should fall back to the last known position',
  );

  console.log('checkin gps nonblocking tests: ok');
}

main();
