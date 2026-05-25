import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve();

function main() {
  const gfLogistics = readFileSync(
    resolve(REPO_ROOT, 'src/services/gfLogistics.ts'),
    'utf8',
  );
  const syncStore = readFileSync(
    resolve(REPO_ROOT, 'src/stores/useSyncStore.ts'),
    'utf8',
  );

  assert.match(gfLogistics, /export async function fetchLeadStages\(/);
  assert.match(gfLogistics, /\$\{GF_BASE\}\/lead\/stages/);
  assert.match(gfLogistics, /export async function upsertLeadData\(/);
  assert.match(gfLogistics, /\$\{GF_BASE\}\/lead\/upsert/);
  assert.match(
    syncStore,
    /case 'prospection':[\s\S]*?upsertLeadData\(/,
    'prospection sync branch must use dedicated lead upsert endpoint',
  );

  const prospectionBlock = syncStore.match(/case 'prospection':[\s\S]*?break;/)?.[0] ?? '';
  assert.doesNotMatch(
    prospectionBlock,
    /model:\s*payload\.model/,
    'prospection branch must not forward legacy crm.lead meta fields',
  );
  assert.doesNotMatch(
    prospectionBlock,
    /\/api\/create_update/,
    'prospection branch must not call legacy /api/create_update',
  );

  console.log('lead endpoint tests: ok');
}

main();
