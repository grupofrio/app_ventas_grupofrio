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
  const postvisit = readFileSync(
    resolve(REPO_ROOT, 'app/postvisit/[stopId].tsx'),
    'utf8',
  );
  const newcustomer = readFileSync(
    resolve(REPO_ROOT, 'app/newcustomer.tsx'),
    'utf8',
  );
  const syncScreen = readFileSync(
    resolve(REPO_ROOT, 'app/sync.tsx'),
    'utf8',
  );
  const profile = readFileSync(
    resolve(REPO_ROOT, 'app/profile.tsx'),
    'utf8',
  );

  assert.match(gfLogistics, /export async function fetchLeadStages\(/);
  assert.match(gfLogistics, /\$\{GF_BASE\}\/lead\/stages/);
  assert.match(gfLogistics, /export async function upsertLeadData\(/);
  assert.match(gfLogistics, /\$\{GF_BASE\}\/lead\/upsert/);
  assert.match(gfLogistics, /export async function createFieldLeadData\(/);
  assert.match(gfLogistics, /\$\{GF_BASE\}\/lead\/create/);
  assert.match(gfLogistics, /export async function convertLeadData\(/);
  assert.match(gfLogistics, /\$\{GF_BASE\}\/lead\/convert/);
  assert.match(
    gfLogistics,
    /buildFieldLeadCreatePayload\(payload\)/,
    'field lead creation must derive operation_id from the persisted queue payload',
  );
  assert.match(
    syncStore,
    /case 'prospection':[\s\S]*?_source === 'nuevo_lead_ruta'[\s\S]*?createFieldLeadData\([\s\S]*?else[\s\S]*?upsertLeadData\(/,
    'field lead prospections must use create while route lead updates keep upsert',
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
  assert.doesNotMatch(
    prospectionBlock,
    /convertLeadData|lead\/convert/,
    'prospection sync queue must not call convert (convert is online-only)',
  );

  assert.match(postvisit, /convertLeadData\(/);
  assert.match(postvisit, /handleConvert/);
  assert.match(postvisit, /Convertir a cliente/);
  assert.match(
    postvisit,
    /Necesitas conexión para convertir este prospecto en cliente/,
  );
  assert.match(postvisit, /isReviewRequiredDuplicateError/);
  assert.match(postvisit, /createConvertLeadIntentController/);
  assert.match(postvisit, /markAmbiguous/);
  assert.match(
    postvisit,
    /No pudimos confirmar si la conversión se completó/,
  );
  assert.match(
    postvisit,
    /async function handleConvert\([\s\S]*?convertLeadData\([\s\S]*?async function handleSave\([\s\S]*?upsertLeadData\(/,
    'convert and save must be separate handlers',
  );
  assert.doesNotMatch(
    postvisit,
    /justConverted \? 'Prospecto convertido a cliente'/,
    'upsert path must not claim conversion success',
  );
  assert.doesNotMatch(
    postvisit,
    /operation_id: createUuidV4\(\)/,
    'convert must not mint a fresh UUID on every press',
  );

  assert.match(
    newcustomer,
    /Prospecto guardado\. Pendiente de sincronizar\./,
  );
  assert.match(syncScreen, /describeProspectionSyncLabel/);
  assert.doesNotMatch(syncScreen, /prospection: 'Operacion'/);
  assert.match(profile, /Nuevo Prospecto/);
  assert.doesNotMatch(profile, /Nuevo Cliente/);

  console.log('lead endpoint tests: ok');
}

main();
