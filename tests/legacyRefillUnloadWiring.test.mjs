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

// ── #11 / #12: guard del dispatcher que intercepta y NO bloquea ──────────────
assert(/isLegacyRefillUnloadItem\(item\)/.test(store), '#11 processOneItem tiene el guard legacy');
// El guard descarta y devuelve true (manejado), no lanza → no bloquea ciclo/Corte.
const guardBlock = store.match(/if \(isLegacyRefillUnloadItem\(item\)\)[\s\S]{0,240}?\n\s*\}/);
assert(guardBlock, '#12 el guard existe como bloque');
assert(/discardLegacyRefillUnload\(item\.id\)/.test(guardBlock[0]), '#11 el guard descarta el ítem');
assert(/return true/.test(guardBlock[0]), '#12 el guard trata el ítem como manejado (no lanza, no bloquea)');

// ── #9: el store expone la migración y el descarte ───────────────────────────
assert(/migrateLegacyRefillUnload:/.test(store), '#9 el store expone migrateLegacyRefillUnload');
assert(/discardLegacyRefillUnload:/.test(store), '#9 el store expone discardLegacyRefillUnload');
// #10 contrato corregido: LEE sin consumir + limpia SOLO tras éxito + durable.
assert(/hasLegacyRefreshPending:/.test(store), '#10 el store expone hasLegacyRefreshPending (peek)');
assert(/markLegacyRefreshCompleted:/.test(store), '#10 el store limpia solo tras éxito');
assert(!/consumeLegacyRefreshPending/.test(store), 'la semántica consume-antes-de-éxito fue eliminada');
assert(/LEGACY_REFRESH_PENDING/.test(store), '#10 el store persiste la marca durable de refresh');
assert(/storeSave\(STORAGE_KEYS\.LEGACY_REFRESH_PENDING/.test(store), '#10 la marca durable se persiste');

// ── rollback legacy por-type ELIMINADO (queda el genérico por delta) ─────────
assert(!/rollback_unload/.test(store), 'el rollback legacy por-type de unload fue eliminado');
assert(!/rollback_refill/.test(store), 'el rollback legacy por-type de refill fue eliminado');
assert(/computeLocalStockReversal\(item\.payload\)/.test(store), 'el rollback genérico por delta se conserva');

// ── arranque: la migración corre al rehidratar ───────────────────────────────
const rehydrate = read('src/services/rehydrate.ts');
assert(/migrateLegacyRefillUnload\(\)/.test(rehydrate), 'rehydrate dispara la migración legacy');

// ── #10: refresh autoritativo de inventario al reconectar (vía runner) ───────
const connectivity = read('src/services/connectivity.ts');
assert(/createLegacyRefreshRunner/.test(connectivity), '#10 connectivity usa el runner del refresh');
assert(/legacyRefreshRunner\.run\(\)/.test(connectivity), '#10 wakeQueue dispara el refresh (fire-and-forget)');
assert(/hasLegacyRefreshPending\(\)/.test(connectivity), '#10 el runner LEE el pending (peek, no consume)');
assert(/markLegacyRefreshCompleted\(\)/.test(connectivity), '#10 limpia solo tras éxito');
assert(/loadProducts\(warehouseId\)/.test(connectivity), '#10 connectivity recarga inventario autoritativo');
assert(!/consumeLegacyRefreshPending/.test(connectivity), 'connectivity ya no usa consume-antes-de-éxito');
// #9 (processQueue): el refresh es fire-and-forget y separado del drenaje.
assert(/store\.processQueue\(\)/.test(connectivity), '#9 processQueue sigue independiente del refresh');

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
