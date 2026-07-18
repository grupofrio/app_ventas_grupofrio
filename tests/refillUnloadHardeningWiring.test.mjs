import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * Wiring PR-3a — hardening rollback/idempotencia refill/unload (SIN cambiar ruteo):
 *  #1 unload adjunta _localStockDelta explícito (sign -1) + operation_id + guard;
 *  #2 unload NO cambia el type de cola (sigue 'prospection');
 *  #3 useSyncStore.rollbackFailedOperation revierte por _localStockDelta ANTES del
 *     switch por-type (funciona aunque el item sea 'prospection') e idempotente;
 *  #4 refill sigue sin tocar stock local (no inventa rollback) y conserva op id;
 *  #5 NO se activan los case 'refill'/'unload' como destino de enqueue.
 */
const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const unload = read('app/unload.tsx');
const refill = read('app/refill.tsx');
const sync = read('src/stores/useSyncStore.ts');
const rollbackHelper = read('src/services/stockRollback.ts');

// #1 unload: _localStockDelta con sign -1 + operation_id + guard doble-tap.
assert(unload.includes('buildLocalStockDelta'), 'unload usa buildLocalStockDelta');
assert(/_localStockDelta:\s*buildLocalStockDelta\(lines,\s*-1\)/.test(unload),
  'unload adjunta _localStockDelta con sign -1 (descuenta)');
assert(/operation_id:\s*getUnloadOperationId\(\)/.test(unload), 'unload envía operation_id estable');
assert(unload.includes('submittingRef'), 'unload tiene guard doble-tap');
// sigue descontando stock local optimista
assert(/updateLocalStock\(l\.product_id,\s*-l\.qty\)/.test(unload), 'unload descuenta stock local');

// #2 unload NO cambia el ruteo — sigue encolando como 'prospection'.
assert(/enqueue\('prospection'/.test(unload), 'unload sigue en prospection (ruteo intacto, PR-3b aparte)');
assert(!/enqueue\('unload'/.test(unload), 'unload NO debe cambiar el type de cola');

// #3 rollback genérico por delta ANTES del switch, e idempotente.
assert(sync.includes('computeLocalStockReversal'), 'rollback usa computeLocalStockReversal');
assert(sync.includes('markLocalStockRolledBack'), 'rollback marca el flag para no revertir dos veces');
// El bloque de reversal aparece antes del `switch (item.type)` en la función.
const rbStart = sync.indexOf('function rollbackFailedOperation');
const reversalIdx = sync.indexOf('computeLocalStockReversal(item.payload)', rbStart);
const switchIdx = sync.indexOf('switch (item.type)', rbStart);
assert(reversalIdx > -1 && switchIdx > -1 && reversalIdx < switchIdx,
  'el rollback por delta debe ir ANTES del switch por type');
assert(/_localStockRolledBack:\s*true/.test(sync), 'el flag idempotente se persiste en la cola');

// #4 refill: sin stock local, con operation_id.
assert(!/updateLocalStock/.test(refill), 'refill NO toca stock local (no inventa rollback)');
assert(/operation_id|getRefillOperationId|buildRefillPayload/.test(refill), 'refill conserva operation_id');

// #5 los case 'refill'/'unload' del dispatcher NO son destino de enqueue (siguen
//    inertes hasta PR-3b); nadie encola esos tipos.
assert(!/enqueue\('refill'/.test(refill) && !/enqueue\('refill'/.test(unload),
  'ningún screen encola el type refill (PR-3b)');
assert(!/enqueue\('unload'/.test(unload), 'ningún screen encola el type unload (PR-3b)');

// El helper puro documenta la convención del delta.
assert(/product_id/.test(rollbackHelper) && /delta/.test(rollbackHelper),
  'stockRollback define la convención product_id/delta');

console.log('refill/unload hardening wiring tests: ok');
