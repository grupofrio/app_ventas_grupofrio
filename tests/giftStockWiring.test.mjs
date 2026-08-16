import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * F3.2 — el regalo también descuenta inventario local optimistamente (S2),
 * igual que la venta (ver tests/offlineSaleWiring.test.mjs). El delta viaja
 * SOLO en el objeto encolado, nunca en el `payload` que se postea directo a
 * createGift (ese no tiene whitelist de campos como buildSalesCreatePayload).
 */
const root = process.cwd();
const gift = fs.readFileSync(path.join(root, 'app/gift/[stopId].tsx'), 'utf8');

assert(gift.includes("from '../../src/services/stockRollback'") && gift.includes('buildLocalStockDelta'),
  'regalo debe construir el delta de stock local para el rollback genérico');

assert(gift.includes('applyGiftStockViaLedger'),
  'el regalo online-confirmado debe aplicar inventario vía ledger (POST-R1A)');
assert(gift.includes('commitQueuedOperationWithLedger') && gift.includes('queueGiftWithLedger'),
  'el regalo offline/retry debe usar barrera atómica queue+ledger');
assert.doesNotMatch(gift, /updateLocalStock\(l\.productId,\s*-l\.qty\)/,
  'el regalo no debe mutar stock con updateLocalStock directo');

assert(/_localStockDelta:\s*localStockDelta/.test(gift),
  'el payload encolado debe llevar el delta de stock local para el rollback');
assert(/_ledgerApplied:\s*true/.test(gift),
  'el payload encolado debe marcar _ledgerApplied para rollback vía ledger');

// El delta NO debe colarse en el payload que se postea directo (createGift
// no whitelistea campos, a diferencia de buildSalesCreatePayload).
assert(/await createGift\(payload\)/.test(gift),
  'la llamada online a createGift debe usar el payload original, sin el delta mezclado');
assert.doesNotMatch(
  gift,
  /createGift\(\s*\{\s*\.\.\.payload,\s*_localStockDelta/,
  'createGift no debe recibir un payload con _localStockDelta mezclado (sin whitelist en el backend)',
);

// Commit points: online ledger-only + offline/retry atomic queue+ledger.
const submitBody = gift.slice(gift.indexOf('async function handleSubmit'));
const deductCalls = submitBody.match(/await deductLocalStockOptimistically\(\)/g) ?? [];
const queueLedgerCalls = submitBody.match(/await queueGiftWithLedger\(\)/g) ?? [];
assert.equal(deductCalls.length, 1,
  'online-success debe descontar vía ledger una vez');
assert.equal(queueLedgerCalls.length, 2,
  'offline + retry-enqueue deben usar queueGiftWithLedger');

console.log('gift stock wiring tests: ok');
