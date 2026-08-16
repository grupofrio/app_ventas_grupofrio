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
  'el regalo debe aplicar inventario vía ledger (POST-R1A)');
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

// Los 3 puntos de commit (offline-enqueue, online-success, retry-enqueue)
// deben deducir antes de navegar fuera de la pantalla.
const submitBody = gift.slice(gift.indexOf('async function handleSubmit'));
const deductCalls = submitBody.match(/await deductLocalStockOptimistically\(\)/g) ?? [];
assert.equal(deductCalls.length, 3,
  'debe descontar stock local en los 3 puntos de confirmación: offline, online-success y retry-enqueue');

console.log('gift stock wiring tests: ok');
