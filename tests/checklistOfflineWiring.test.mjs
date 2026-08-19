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

  // Una respuesta reparada online borra exclusivamente sus residuos terminales.
  assert.match(
    syncStore,
    /removeDeadQueueItems:\s*\(ids\)\s*=>\s*\{[\s\S]{0,900}i\.status !== 'dead' \|\| !ids\.includes\(i\.id\)/,
    'el store expone eliminación selectiva que nunca borra IDs vivos',
  );
  assert.match(
    syncStore,
    /removeDeadQueueItems:[\s\S]{0,1200}computeCounts\(newQueue\)[\s\S]{0,300}schedulePersist\(\)/,
    'la eliminación selectiva recompone contadores y persiste',
  );

  // Pantalla: borradores persistidos por plan (sobreviven reinicio).
  assert.match(
    screen,
    /storeSave\(checklistDraftsStorageKey\(planIdNum\), drafts\)/,
    'los borradores deben persistirse al cambiar',
  );
  assert.match(
    screen,
    /storeLoad<Record<number, ChecklistDraft>>\(checklistDraftsStorageKey\(planIdNum\)\)/,
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
  assert.match(
    screen,
    /await submitVehicleCheck\(check\.id, payload\);[\s\S]{0,500}collectDeadChecklistAnswerOpIds\([\s\S]{0,250}header\?\.id \?\? 0,[\s\S]{0,150}check\.id[\s\S]{0,300}removeDeadQueueItems/,
    'un envío online exitoso elimina los dead del mismo check',
  );
  assert.match(
    screen,
    /validateRequiredChecklistDrafts\(checks, drafts\)[\s\S]{0,400}if \(!validation\.ok\) \{[\s\S]{0,250}return;/,
    'la validación local de requeridos corre ANTES de cualquier mutación de red',
  );
  assert.match(screen, /Guardar y completar checklist/, 'un solo CTA guarda y completa');
  assert.doesNotMatch(
    screen,
    /label=\{check\.answered \? 'Actualizar' : 'Guardar'\}/,
    'no debe haber Guardar/Actualizar por punto',
  );

  // Pantalla: cierre offline con dependsOn de las respuestas encoladas y
  // requeridos completos (contando encolados).
  assert.match(screen, /enqueue\(\s*'vehicle_checklist_complete',/, 'el cierre offline se encola');
  assert.match(
    screen,
    /function completeOffline\(capturedPlanId: number, queue: SyncQueueItem\[\]\): boolean \{[\s\S]{0,1200}collectQueuedChecklistAnswerOps\(\s*queue,/,
    'el dependsOn del cierre se deriva de la COLA (durable), no de refs en memoria',
  );
  assert.match(screen, /dependsOn: pendingAnswerOps/, 'el cierre depende de las respuestas encoladas');
  // P1: sin completado local prematuro ni borrado de borradores en el cierre offline.
  assert.match(screen, /Cierre pendiente de envío/, 'el cierre offline se comunica como pendiente, no completo');
  assert.doesNotMatch(
    screen,
    /pendingAnswerOps[\s\S]{0,600}setChecklistCompleteForPlan\(capturedPlanId, true\)/,
    'el cierre offline no debe marcar el checklist como completo localmente',
  );
  // P1: gate de hidratación — no persistir antes de cargar.
  assert.match(screen, /!draftsHydrated\) return;/, 'el guardado de borradores espera la hidratación');
  // P1: el snapshot cacheado re-proyecta respuestas encoladas.
  assert.match(screen, /usingCachedSnapshot \|\| !draftsHydrated/, 'la re-proyección corre tras snapshot+hidratación');
  // Los borradores solo se limpian cuando el SERVIDOR confirma completed.
  assert.match(
    screen,
    /state === 'completed'[\s\S]{0,300}storeRemove\(checklistDraftsStorageKey/,
    'la limpieza de borradores exige confirmación del servidor',
  );
  assert.match(screen, /areRequiredChecksAnswered\(checks\)/, 'el cierre offline valida requeridos localmente');
  assert.match(
    screen,
    /no detienen la salida/,
    'el copy comunica la política: documenta, no detiene',
  );

  // Un dead que aún es la última respuesta de un check OBLIGATORIO debe
  // detener el nuevo cierre offline antes de derivar dependsOn/enviar la
  // operación. El mensaje de reparación es el mismo que ve el usuario en el
  // banner; un check opcional dead sigue siendo sólo informativo.
  assert.match(
    screen,
    /const CHECKLIST_DEAD_REPAIR_COPY\s*=/,
    'la pantalla define un copy de reparación compartido para respuestas dead',
  );
  assert.match(
    screen,
    /function hasRequiredDeadChecklistAnswers\(queue: SyncQueueItem\[\]\): boolean \{[\s\S]{0,500}collectDeadChecklistAnswerCheckIds\(queue, header\?\.id \?\? 0\)/,
    'el guard compartido deriva los IDs dead vigentes de la cola recibida',
  );
  assert.match(
    screen,
    /const requiredDeadCheckIds = checks[\s\S]{0,220}\.filter\(\(check\) => check\.required && deadCheckIds\.includes\(check\.id\)\)[\s\S]{0,220}if \(requiredDeadCheckIds\.length > 0\) \{[\s\S]{0,300}CHECKLIST_DEAD_REPAIR_COPY[\s\S]{0,180}return true;/,
    'sólo los dead de checks requeridos activan el guard compartido',
  );
  assert.match(
    screen,
    /function completeOffline\(capturedPlanId: number, queue: SyncQueueItem\[\]\): boolean \{[\s\S]{0,300}hasRequiredDeadChecklistAnswers\(queue\)[\s\S]{0,180}return false;[\s\S]{0,650}collectQueuedChecklistAnswerOps\(\s*queue,/,
    'completeOffline reutiliza el guard antes de derivar dependencies o encolar',
  );
  assert.match(
    screen,
    /async function handleComplete\(\) \{[\s\S]{0,700}const queue = useSyncStore\.getState\(\)\.queue;[\s\S]{0,500}hasQueuedChecklistComplete\(queue,[\s\S]{0,500}hasRequiredDeadChecklistAnswers\(queue\)[\s\S]{0,180}return;[\s\S]{0,600}collectQueuedChecklistAnswerOps\(\s*queue,[\s\S]{0,700}completeVehicleChecklist\(/,
    'handleComplete bloquea dead requeridos antes de elegir cierre offline o llamar al servidor',
  );
  assert.match(
    screen,
    /await handleComplete\(\);[\s\S]{0,80}catch \(err\) \{[\s\S]{0,500}isRetryableSyncErrorMessage\(msg\)[\s\S]{0,500}completeOffline\(capturedPlanId, useSyncStore\.getState\(\)\.queue\)/,
    'el fallback reintentable relee la cola actual después del await antes de aplicar guard/dependencies',
  );
  assert.match(
    screen,
    /deadCheckIds\.length > 0[\s\S]{0,500}CHECKLIST_DEAD_REPAIR_COPY/,
    'el banner de respuestas dead reutiliza el copy de reparación del gate',
  );

  console.log('checklist offline wiring tests: ok');
}

main();
