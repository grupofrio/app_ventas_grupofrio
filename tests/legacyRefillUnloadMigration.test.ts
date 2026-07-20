/**
 * Migración de compatibilidad de eventos legacy refill/unload (una versión).
 * Lógica PURA: detección, plan de reversión idempotente, partición, copy.
 *
 * Cubre (nivel lógica) los requisitos:
 *  #5 evento legacy refill se detecta (para NO enviarlo);
 *  #6 evento legacy unload se detecta (para NO enviarlo);
 *  #7 el delta local se revierte una sola vez;
 *  #8 una migración repetida no vuelve a modificar stock;
 *  #9 el evento legacy se separa de la cola (partición).
 */
import assert from 'node:assert/strict';

type Mod = typeof import('../src/services/legacyRefillUnloadMigration.ts');

function testDetection(m: Mod) {
  // Por type de cola (dispatcher viejo).
  assert.equal(m.legacyRefillUnloadKind({ type: 'refill', payload: {} }), 'refill');
  assert.equal(m.legacyRefillUnloadKind({ type: 'unload', payload: {} }), 'unload');
  // Por payload.model (encolado como prospection).
  assert.equal(m.legacyRefillUnloadKind({ type: 'prospection', payload: { model: 'van.refill.request' } }), 'refill');
  assert.equal(m.legacyRefillUnloadKind({ type: 'prospection', payload: { model: 'van.unload.request' } }), 'unload');
  assert.equal(m.legacyRefillUnloadKind({ type: 'prospection', payload: { model: 'van.unload' } }), 'unload');
  // Por payload.type.
  assert.equal(m.legacyRefillUnloadKind({ type: 'prospection', payload: { type: 'refill' } }), 'refill');
  assert.equal(m.legacyRefillUnloadKind({ type: 'prospection', payload: { type: 'unload' } }), 'unload');
  // NO legacy: otros prospection / tipos normales.
  assert.equal(m.legacyRefillUnloadKind({ type: 'prospection', payload: { model: 'crm.lead' } }), null);
  assert.equal(m.legacyRefillUnloadKind({ type: 'sale_order', payload: {} }), null);
  assert.equal(m.legacyRefillUnloadKind(null), null);
  assert.equal(m.isLegacyRefillUnloadItem({ type: 'prospection', payload: { type: 'unload' } }), true);
  assert.equal(m.isLegacyRefillUnloadItem({ type: 'checkin', payload: {} }), false);
  console.log('detection: ok');
}

function testUnloadDeltaReversal(m: Mod) {
  // unload con _localStockDelta (sign -1) → revierte sumando para restaurar.
  const item = {
    id: 'u1', type: 'prospection',
    payload: { type: 'unload', model: 'van.unload.request',
      lines: [{ product_id: 5, qty: 3 }], _localStockDelta: [{ product_id: 5, delta: -3 }] },
  };
  const plan = m.planLegacyReversal(item)!;
  assert.equal(plan.kind, 'unload');
  assert.equal(plan.source, 'delta');
  assert.deepEqual(plan.reversal, [{ product_id: 5, qty: 3 }]);
  console.log('unload delta reversal: ok');
}

function testDeltaAlreadyRolledBackIsNone(m: Mod) {
  // #7/#8: delta ya revertido (_localStockRolledBack) → source 'none', sin doble reversión.
  const item = {
    id: 'u2', type: 'prospection',
    payload: { type: 'unload', lines: [{ product_id: 5, qty: 3 }],
      _localStockDelta: [{ product_id: 5, delta: -3 }], _localStockRolledBack: true },
  };
  const plan = m.planLegacyReversal(item)!;
  assert.equal(plan.source, 'none');
  assert.deepEqual(plan.reversal, []);
  console.log('delta already rolled back → none: ok');
}

function testUnloadWithoutDeltaRestoresLinesOnce(m: Mod) {
  // #7: unload legacy SIN delta explícito → restaura líneas una vez (source unload_lines).
  const item = {
    id: 'u3', type: 'unload',
    payload: { lines: [{ product_id: 7, qty: 4 }, { product_id: 8, qty: 0 }] },
  };
  const plan = m.planLegacyReversal(item)!;
  assert.equal(plan.source, 'unload_lines');
  assert.deepEqual(plan.reversal, [{ product_id: 7, qty: 4 }]); // qty 0 ignorada
  // #8: ya marcado como restaurado → source 'none' (no doble restauración).
  const restored = { ...item, payload: { ...item.payload, _legacyStockRestored: true } };
  const plan2 = m.planLegacyReversal(restored)!;
  assert.equal(plan2.source, 'none');
  assert.deepEqual(plan2.reversal, []);
  console.log('unload lines restore once: ok');
}

function testRefillDoesNotTouchStock(m: Mod) {
  // #5: refill legacy sin delta → NO toca stock (source 'none').
  const item = {
    id: 'r1', type: 'prospection',
    payload: { type: 'refill', model: 'van.refill.request', lines: [{ product_id: 1, qty: 10 }] },
  };
  const plan = m.planLegacyReversal(item)!;
  assert.equal(plan.kind, 'refill');
  assert.equal(plan.source, 'none');
  assert.deepEqual(plan.reversal, []);
  // refill CON delta comprobable (caso defensivo) → sí revierte solo lo comprobable.
  const withDelta = { id: 'r2', type: 'refill',
    payload: { _localStockDelta: [{ product_id: 1, delta: 10 }] } };
  const plan2 = m.planLegacyReversal(withDelta)!;
  assert.equal(plan2.source, 'delta');
  assert.deepEqual(plan2.reversal, [{ product_id: 1, qty: -10 }]);
  console.log('refill no stock (delta only): ok');
}

function testConsumedFlag(m: Mod) {
  assert.equal(m.consumedFlagForSource('delta'), '_localStockRolledBack');
  assert.equal(m.consumedFlagForSource('unload_lines'), '_legacyStockRestored');
  assert.equal(m.consumedFlagForSource('none'), null);
  console.log('consumed flag: ok');
}

function testPartition(m: Mod) {
  // #9: separa legacy del resto sin tocar los legítimos.
  const queue = [
    { id: 'a', type: 'sale_order', payload: {} },
    { id: 'b', type: 'prospection', payload: { model: 'van.refill.request' } },
    { id: 'c', type: 'prospection', payload: { model: 'crm.lead' } },
    { id: 'd', type: 'unload', payload: {} },
    { id: 'e', type: 'checkin', payload: {} },
  ];
  const { legacy, kept } = m.partitionLegacyRefillUnload(queue);
  assert.deepEqual(legacy.map((i) => i.id), ['b', 'd']);
  assert.deepEqual(kept.map((i) => i.id), ['a', 'c', 'e']);
  console.log('partition: ok');
}

function testNoticeCopy(m: Mod) {
  const copy = m.legacyMigrationNoticeCopy(3);
  assert.match(copy.body, /3/);
  assert.match(copy.body, /Almac[eé]n/i);
  assert.match(copy.body, /Corte/i);
  console.log('notice copy: ok');
}

async function main() {
  const m = (await import(
    // @ts-ignore -- import.meta solo existe en el runtime de test.
    new URL('../src/services/legacyRefillUnloadMigration.ts', import.meta.url).pathname
  )) as Mod;

  testDetection(m);
  testUnloadDeltaReversal(m);
  testDeltaAlreadyRolledBackIsNone(m);
  testUnloadWithoutDeltaRestoresLinesOnce(m);
  testRefillDoesNotTouchStock(m);
  testConsumedFlag(m);
  testPartition(m);
  testNoticeCopy(m);
  console.log('legacy refill/unload migration tests: ok');
}

void main();
