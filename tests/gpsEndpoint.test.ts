import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

function main() {
  const syncStore = readFileSync(
    resolve(REPO_ROOT, 'src/stores/useSyncStore.ts'),
    'utf8',
  );

  assert.match(
    syncStore,
    /\/pwa-ruta\/gps-batch/,
    'GPS sync must use the dedicated /pwa-ruta/gps-batch endpoint',
  );

  const batchBlock = syncStore.match(/async function tryGpsBatchCreate[\s\S]*?^}/m)?.[0] ?? '';
  const gpsCaseBlock = syncStore.match(/case 'gps':[\s\S]*?break;/)?.[0] ?? '';

  assert.doesNotMatch(
    `${batchBlock}\n${gpsCaseBlock}`,
    /\/api\/create_update|os\.employee\.gps\.history/,
    'GPS sync must not write through legacy /api/create_update or expose os.employee.gps.history',
  );

  console.log('gps endpoint tests: ok');
}

main();
