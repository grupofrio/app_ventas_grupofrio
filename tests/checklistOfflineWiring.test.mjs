import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = process.cwd();

const screen = readFileSync(resolve(REPO_ROOT, 'app/checklist/[planId].tsx'), 'utf8');
const syncStore = readFileSync(resolve(REPO_ROOT, 'src/stores/useSyncStore.ts'), 'utf8');
const syncTypes = readFileSync(resolve(REPO_ROOT, 'src/types/sync.ts'), 'utf8');

function main() {
  // Tipos de cola nuevos con prioridad de negocio.
  assert.match(syncTypes, /'vehicle_check'/, 'la cola debe soportar respuestas de checklist');
  assert.match(syncTypes, /'vehicle_checklist_complete'/, 'la cola debe soportar el cierre de checklist');
  assert.match(syncTypes, /vehicle_check: 1,/, 'las respuestas de checklist son prioridad 1');
  assert.match(syncTypes, /vehicle_checklist_complete: 1,/, 'el cierre de checklist es prioridad 1');

  // Dispatcher: respuesta lee la foto del disco AL ENVIAR; cierre reusa el
  // servicio idempotente (already_completed = éxito).
  assert.match(syncStore, /case 'vehicle_check': \{/, 'el dispatcher debe procesar vehicle_check');
  assert.match(
    syncStore,
    /const base64 = await readPhotoAsBase64\(photoUri\);/,
    'la foto del checklist se lee del disco al enviar, no se serializa en la cola',
  );
  assert.match(syncStore, /case 'vehicle_checklist_complete':/, 'el dispatcher debe procesar el cierre');
  assert.match(
    syncStore,
    /await completeVehicleChecklist\(/,
    'el cierre encolado reusa el servicio tolerante a already_completed',
  );

  // Pantalla: borradores persistidos por plan (sobreviven reinicio).
  assert.match(
    screen,
    /storeSave\(checklistDraftsStorageKey\(planIdNum\), drafts\)/,
    'los borradores deben persistirse al cambiar',
  );
  assert.match(
    screen,
    /storeLoad<Record<number, CheckDraft>>\(checklistDraftsStorageKey\(planIdNum\)\)/,
    'los borradores deben rehidratarse al montar',
  );

  // Pantalla: snapshot cacheado para llenar offline tras reinicio.
  assert.match(
    screen,
    /storeSave\(checklistSnapshotStorageKey\(capturedPlanId\), \{ header: h, checks: c \}\)/,
    'la carga buena debe cachear header+checks',
  );
  assert.match(
    screen,
    /setUsingCachedSnapshot\(true\)/,
    'el fallo de red debe caer al snapshot cacheado',
  );

  // Pantalla: offline o error reintentable encolan la respuesta con
  // proyección optimista (mismas reglas de passed que el backend).
  assert.match(screen, /enqueue\('vehicle_check', buildVehicleCheckQueuePayload\(/, 'la respuesta offline se encola');
  assert.match(screen, /applyLocalCheckAnswer\(cs, check\.id, payload\)/, 'la respuesta encolada se proyecta local');
  assert.match(
    screen,
    /if \(isRetryableSyncErrorMessage\(msg\)\) \{\s*\n\s*\/\/ Red degradada a media petición: mismo camino que offline\./,
    'un fallo de red a media petición encola en vez de perder la respuesta',
  );

  // Pantalla: cierre offline con dependsOn de las respuestas encoladas y
  // requeridos completos (contando encolados).
  assert.match(screen, /enqueue\(\s*'vehicle_checklist_complete',/, 'el cierre offline se encola');
  assert.match(screen, /dependsOn: \[\.\.\.queuedAnswerOpsRef\.current\]/, 'el cierre depende de las respuestas encoladas');
  assert.match(screen, /areRequiredChecksAnswered\(checks\)/, 'el cierre offline valida requeridos localmente');
  assert.match(
    screen,
    /no detienen la salida/,
    'el copy comunica la política: documenta, no detiene',
  );

  console.log('checklist offline wiring tests: ok');
}

main();
