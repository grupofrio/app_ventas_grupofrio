import assert from 'node:assert/strict';

type Mod = typeof import('../src/services/stockRollback.ts');

function testBuildDelta(m: Mod) {
  // unload descuenta → sign -1 → delta negativo
  assert.deepEqual(
    m.buildLocalStockDelta([{ product_id: 5, qty: 3 }, { product_id: 7, qty: 2 }], -1),
    [{ product_id: 5, delta: -3 }, { product_id: 7, delta: -2 }],
  );
  // sign +1 (operación que agrega stock)
  assert.deepEqual(m.buildLocalStockDelta([{ product_id: 9, qty: 4 }], 1), [{ product_id: 9, delta: 4 }]);
  // ignora líneas inválidas / qty 0
  assert.deepEqual(
    m.buildLocalStockDelta(
      [{ product_id: 1, qty: 0 }, { product_id: 2, qty: 3 }, { product_id: NaN, qty: 1 } as never],
      -1,
    ),
    [{ product_id: 2, delta: -3 }],
  );
  console.log('build delta: ok');
}

function testReversal(m: Mod) {
  // (1) unload con delta local → revierte (suma para restaurar lo descontado)
  assert.deepEqual(
    m.computeLocalStockReversal({ _localStockDelta: [{ product_id: 5, delta: -3 }] }),
    [{ product_id: 5, qty: 3 }],
  );
  // (2) type-agnóstico: la función solo mira el payload (no hay parámetro type).
  //     Un payload de unload encolado como 'prospection' revierte igual.
  assert.deepEqual(
    m.computeLocalStockReversal({ type: 'unload', _localStockDelta: [{ product_id: 8, delta: -2 }] }),
    [{ product_id: 8, qty: 2 }],
  );
  // (3) NO revierte dos veces: _localStockRolledBack ⇒ []
  assert.deepEqual(
    m.computeLocalStockReversal({ _localStockDelta: [{ product_id: 5, delta: -3 }], _localStockRolledBack: true }),
    [],
  );
  // (4) sin _localStockDelta ⇒ [] (no inventa rollback)
  assert.deepEqual(m.computeLocalStockReversal({ type: 'checkin' }), []);
  assert.deepEqual(m.computeLocalStockReversal({}), []);
  assert.deepEqual(m.computeLocalStockReversal(null), []);
  // delta 0 / entradas inválidas se ignoran
  assert.deepEqual(
    m.computeLocalStockReversal({ _localStockDelta: [{ product_id: 5, delta: 0 }, { product_id: 6, delta: -1 }] }),
    [{ product_id: 6, qty: 1 }],
  );
  // _localStockDelta no-array ⇒ []
  assert.deepEqual(m.computeLocalStockReversal({ _localStockDelta: 'nope' }), []);
  console.log('reversal: ok');
}

function testPayloadWithoutDeltaHasNoReversal(m: Mod) {
  // (5) un payload que NO adjunta _localStockDelta (p.ej. una operación que no
  //     toca stock local) no debe inventar reversión — el rollback genérico solo
  //     revierte lo comprobable.
  const payloadSinDelta = {
    type: 'prospection',
    operation_id: 'op-abc',
    lines: [{ product_id: 1, qty: 10 }],
    timestamp: 1_700_000_123_456,
  };
  assert.equal('_localStockDelta' in payloadSinDelta, false);
  assert.deepEqual(m.computeLocalStockReversal(payloadSinDelta), []);
  console.log('payload sin delta: no reversal ok');
}

async function main() {
  const m = (await import(
    // @ts-ignore -- import.meta solo existe en el runtime de test.
    new URL('../src/services/stockRollback.ts', import.meta.url).pathname
  )) as Mod;

  testBuildDelta(m);
  testReversal(m);
  testPayloadWithoutDeltaHasNoReversal(m);
  console.log('stockRollback tests: ok');
}

void main();
