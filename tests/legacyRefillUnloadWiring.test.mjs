/**
 * Wiring de la limpieza legacy refill/unload (PR frontend).
 * Verifica a nivel FUENTE que:
 *   - las pantallas/servicios legacy fueron eliminados;
 *   - la aceptación de recarga y el Corte siguen accesibles;
 *   - el dispatcher ya no envía refill/unload y tiene el guard;
 *   - el store expone la migración y el refresh autoritativo se dispara al reconectar.
 *
 * Cubre (nivel wiring) los requisitos #1, #2, #3, #4, #9, #10, #11, #12.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');
const exists = (p) => existsSync(root + p);

// ── #3 / #1: pantallas y servicio legacy ELIMINADOS ──────────────────────────
assert(!exists('app/refill.tsx'), '#1 app/refill.tsx debe estar eliminado');
assert(!exists('app/unload.tsx'), '#3 app/unload.tsx debe estar eliminado');
assert(!exists('src/services/refillLogic.ts'), 'refillLogic.ts debe estar eliminado');

// ── #2: aceptación de recarga CONSERVADA ─────────────────────────────────────
assert(exists('app/refill-accept.tsx'), '#2 refill-accept.tsx debe conservarse');
const routeActions = read('src/services/routeActions.ts');
assert(/route:\s*'\/refill-accept'/.test(routeActions), '#2 el menú apunta a /refill-accept');
assert(!/route:\s*'\/refill'\s*[,}]/.test(routeActions), '#1 el menú NO apunta a /refill legacy');
assert(!/route:\s*'\/unload'/.test(routeActions), '#3 el menú NO apunta a /unload');

// ── #1: la pantalla de ruta no navega a /refill ni /unload legacy ────────────
const routeScreen = read('app/(tabs)/route.tsx');
assert(!/push\(\s*'\/refill'\s*/.test(routeScreen), '#1 route.tsx no navega a /refill legacy');
assert(!/push\(\s*'\/unload'\s*/.test(routeScreen), '#3 route.tsx no navega a /unload');
assert(/\/refill-accept/.test(routeScreen), '#2 route.tsx conserva la aceptación de recarga');

// ── #4: Corte/cierre accesible ───────────────────────────────────────────────
assert(/\/route-close/.test(routeScreen), '#4 el cierre/Corte sigue accesible desde la ruta');

// ── #5 / #6: el dispatcher YA NO envía refill/unload ─────────────────────────
const store = read('src/stores/useSyncStore.ts');
assert(!/case 'refill':/.test(store), "#5 no debe existir case 'refill' en el dispatcher");
assert(!/case 'unload':/.test(store), "#6 no debe existir case 'unload' en el dispatcher");
assert(!/van\.refill\.request/.test(store), '#5 el store no debe referir van.refill.request');
assert(!/van\.unload/.test(store), '#6 el store no debe referir van.unload');

// ── #11 / #12 / #14 / #15: guard del dispatcher — intercepta, awaits durable,
//     no envía si la persistencia crítica falla, y NO bloquea al resto ─────────
assert(/isLegacyRefillUnloadItem\(item\)/.test(store), '#11 processOneItem tiene el guard legacy');
const guardBlock = store.match(/if \(isLegacyRefillUnloadItem\(item\)\)[\s\S]{0,1000}?\n\s{2}\}/);
assert(guardBlock, '#12 el guard existe como bloque');
assert(/await get\(\)\.discardLegacyRefillUnload\(item\.id\)/.test(guardBlock[0]),
  '#14 el guard AWAITa la operación durable (misma que la migración)');
assert(/res\.status === 'completed'/.test(guardBlock[0]), 'el guard decide según el status durable');
assert(/return 'handled'/.test(guardBlock[0]), '#12 solo maneja si la reparación quedó durable (completed)');
assert(/res\.status === 'deferred'/.test(guardBlock[0]), '#14 detecta el diferido por fallo de persistencia');
assert(/deferLegacyMigrationItem\(item\.id\)/.test(guardBlock[0]),
  'P1 el guard DIFIERE con backoff (no dead, no reenvío, no drain_now)');
assert(/return 'deferred'/.test(guardBlock[0]),
  '#15 no lo marca manejado; conserva con backoff sin bloquear al resto');

// ── P1: el diferido NO puede disparar drain_now ──────────────────────────────
assert(/hadDeferredStorageFailure/.test(store),
  'P1 el ciclo rastrea el fallo de persistencia diferido');
assert(/deferLegacyMigrationItem:/.test(store), 'P1 el store expone deferLegacyMigrationItem (backoff, no dead)');
// el diferido se marca error con retries:0 (nunca dead) y next_retry_at (backoff).
const deferBlock = store.match(/deferLegacyMigrationItem: \(id\) =>[\s\S]{0,700}?schedulePersist\(\);/);
assert(deferBlock, 'deferLegacyMigrationItem existe');
assert(/retries: 0/.test(deferBlock[0]), 'P1 el diferido NO acumula retries (nunca dead)');
assert(/next_retry_at: Date\.now\(\) \+ LEGACY_DEFER_BACKOFF_MS/.test(deferBlock[0]),
  'P1 el diferido usa backoff (no 0 ms)');
// la decisión post-ciclo recibe la señal para forzar backoff en vez de drain_now.
assert(/hadDeferredStorageFailure,\n\s*queue: get\(\)\.queue/.test(store)
  || /decidePostCycleActionAfterCycle\(\{[\s\S]{0,120}hadDeferredStorageFailure/.test(store),
  'P1 la señal se pasa a decidePostCycleActionAfterCycle');
// no existe ok:true para reverted_removal_unpersisted (nunca éxito).
const migSvc = read('src/services/legacyRefillUnloadMigration.ts');
assert(/reverted_removal_unpersisted/.test(migSvc), 'existe la fase reverted_removal_unpersisted');
assert(!/ok: true, phase: 'reverted_removal_unpersisted'/.test(migSvc),
  'reverted_removal_unpersisted NUNCA es ok:true');
// syncWakeup: la decisión prohíbe drain_now cuando hubo diferido.
const wakeup = read('src/services/syncWakeup.ts');
assert(/hadDeferredStorageFailure/.test(wakeup), 'decidePostCycleActionAfterCycle contempla el diferido');

// ── #9: el store expone la migración durable y el descarte ───────────────────
assert(/migrateLegacyRefillUnload: async/.test(store), '#9 migrateLegacyRefillUnload es async (durable)');
assert(/discardLegacyRefillUnload: async/.test(store), '#9 discardLegacyRefillUnload es async (durable)');
// único helper durable compartido (no duplicar lógica entre migración y guard).
assert(/durableMigrateLegacy/.test(store), 'existe un único helper durable compartido');
assert(/runDurableLegacyMigration/.test(store), 'el store usa el orquestador durable');
// #10 contrato: LEE sin consumir + limpia SOLO tras éxito + DURABLE ESTRICTA.
assert(/hasLegacyRefreshPending:/.test(store), '#10 el store expone hasLegacyRefreshPending (peek)');
assert(/markLegacyRefreshCompleted: async/.test(store), '#10 markCompleted es async (limpieza durable esperada)');
assert(!/consumeLegacyRefreshPending/.test(store), 'la semántica consume-antes-de-éxito fue eliminada');
assert(/storeSaveStrict\(STORAGE_KEYS\.LEGACY_REFRESH_PENDING, true\)/.test(store),
  '#1 la marca pending=true se persiste ESTRICTA (observa fallos)');
assert(/storeSaveStrict\(STORAGE_KEYS\.LEGACY_REFRESH_PENDING, false\)/.test(store),
  '#8 la limpieza durable usa persistencia ESTRICTA');
assert(/storeSaveStrict\(STORAGE_KEYS\.SYNC_QUEUE/.test(store), 'la cola se persiste ESTRICTA en la transición');

// ── rollback legacy por-type ELIMINADO (queda el genérico por delta) ─────────
assert(!/rollback_unload/.test(store), 'el rollback legacy por-type de unload fue eliminado');
assert(!/rollback_refill/.test(store), 'el rollback legacy por-type de refill fue eliminado');
assert(/computeLocalStockReversal\(item\.payload\)/.test(store), 'el rollback genérico por delta se conserva');

// ── arranque: la migración corre al rehidratar (await) + wake post-rehydrate ──
const rehydrate = read('src/services/rehydrate.ts');
assert(/await useSyncStore\.getState\(\)\.migrateLegacyRefillUnload\(\)/.test(rehydrate),
  'rehydrate AWAITa la migración durable');
assert(/requestLegacyAuthoritativeRefresh\(\)/.test(rehydrate),
  'rehydrate dispara el refresh post-bootstrap sin esperar transición de NetInfo');

// ── #10: refresh autoritativo AUTORITATIVO (vía runner + resultado tipado) ───
const connectivity = read('src/services/connectivity.ts');
assert(/createLegacyRefreshRunner/.test(connectivity), '#10 connectivity usa el runner del refresh');
assert(/export function requestLegacyAuthoritativeRefresh/.test(connectivity),
  'connectivity exporta el disparador reutilizable');
assert(/hasLegacyRefreshPending\(\)/.test(connectivity), 'el runner LEE el pending (peek, no consume)');
assert(/isOnline:/.test(connectivity), '#10 el runner respeta online (offline conserva)');
assert(/loadProductsAuthoritative\(warehouseId\)/.test(connectivity),
  '#6/#7 usa la carga AUTORITATIVA explícita (no infiere por error/null)');
assert(/markLegacyRefreshCompleted\(\)/.test(connectivity), '#8 limpia solo tras éxito');
assert(!/consumeLegacyRefreshPending/.test(connectivity), 'connectivity ya no usa consume-antes-de-éxito');
assert(!/loadProducts\(warehouseId\)/.test(connectivity), 'ya no usa loadProducts crudo (no autoritativo)');
// #9/#15 (processQueue): el refresh es fire-and-forget y separado del drenaje.
assert(/store\.processQueue\(\)/.test(connectivity), 'processQueue sigue independiente del refresh');

// ── P2: suscripción REAL a warehouseId (única + cleanup) ─────────────────────
assert(/useAuthStore\.subscribe\(/.test(connectivity), 'P2 connectivity se suscribe al store de auth');
assert(/shouldWakeOnWarehouseTransition\(/.test(connectivity), 'P2 usa el helper de transición de warehouse');
assert(/authUnsubscribe/.test(connectivity), 'P2 guarda el unsubscribe para limpiarlo');
// una sola suscripción (guard) + cleanup en stopConnectivityMonitor.
assert(/if \(!authUnsubscribe\)/.test(connectivity), 'P2 suscripción ÚNICA (guard)');
const stopBlock = connectivity.match(/export function stopConnectivityMonitor[\s\S]{0,600}?\n\}/);
assert(stopBlock && /authUnsubscribe\(\);\s*\n\s*authUnsubscribe = null;/.test(stopBlock[0]),
  'P2 stopConnectivityMonitor limpia la suscripción');
assert(/requestLegacyAuthoritativeRefresh\(\)/.test(connectivity),
  'P2 reutiliza el runner singleton (no crea uno nuevo)');
// singleton: un solo createLegacyRefreshRunner en el módulo.
assert((connectivity.match(/createLegacyRefreshRunner\(/g) || []).length === 1,
  'P2 un ÚNICO runner singleton compartido');

// ── storage: variantes ESTRICTAS que rechazan en fallo ───────────────────────
const storage = read('src/persistence/storage.ts');
assert(/export async function storeSaveStrict/.test(storage), 'existe storeSaveStrict (rechaza en fallo)');
assert(/export async function storeRemoveStrict/.test(storage), 'existe storeRemoveStrict');

// ── #6/#7: carga con resultado AUTORITATIVO explícito en el product store ─────
const productStore = read('src/stores/useProductStore.ts');
assert(/loadProductsAuthoritative:/.test(productStore), 'useProductStore expone loadProductsAuthoritative');
assert(/global_legacy_fallback/.test(productStore), 'distingue el fallback global (no autoritativo)');
assert(/warehouse_mismatch/.test(productStore), 'detecta warehouse distinto');

// ── copy de refill retirado; sync.tsx ya no usa syncItemLabel ────────────────
const copy = read('src/services/secondaryFlowCopy.ts');
assert(!/refillSavedMessage/.test(copy), 'refillSavedMessage eliminado');
assert(!/isRefillSyncItem|syncItemLabel/.test(copy), 'helpers de etiqueta de refill eliminados');
const syncScreen = read('app/sync.tsx');
assert(!/syncItemLabel/.test(syncScreen), 'sync.tsx ya no usa syncItemLabel');

// ── tipos de cola: refill/unload retirados ───────────────────────────────────
const syncTypes = read('src/types/sync.ts');
assert(!/'refill'/.test(syncTypes) && !/'unload'/.test(syncTypes), 'SyncItemType sin refill/unload');

// ── aviso no bloqueante cableado en el home ──────────────────────────────────
const home = read('app/(tabs)/index.tsx');
assert(/legacyMigrationNoticeCopy/.test(home), 'el home muestra el aviso no bloqueante');
assert(/clearLegacyNotice|clearLegacyMigrationNotice/.test(home), 'el aviso es descartable');

console.log('legacy refill/unload wiring tests: ok');
