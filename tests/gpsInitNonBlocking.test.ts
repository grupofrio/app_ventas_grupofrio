import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

function main() {
  const layout = readFileSync(resolve(REPO_ROOT, 'app/_layout.tsx'), 'utf8');
  const initBlock = layout.match(/\/\/ 3\. GPS Initialization[\s\S]*?\/\/ 4\. Connectivity monitor/)?.[0] ?? '';

  assert.doesNotMatch(
    initBlock,
    /await initializeGPS\(|await startBackgroundTracking\(/,
    'GPS startup must not block app readiness',
  );

  console.log('gps init nonblocking tests: ok');
}

main();
