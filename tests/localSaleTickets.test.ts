import assert from 'node:assert/strict';

async function main() {
  // @ts-ignore -- Node 24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime.
    new URL('../src/services/localSaleTickets.ts', import.meta.url).pathname
  );

  const { collectLocalSaleOperationIds, selectProjectableSaleItems } = module;

  const queue = [
    { id: 'op-1', type: 'sale_order', status: 'pending' },
    { id: 'op-2', type: 'photo', status: 'pending' },
    { id: 'op-3', type: 'sale_order', status: 'error' },
    { id: 'op-1', type: 'sale_order', status: 'pending' }, // duplicado
    { id: 'op-4', type: 'sale_order', status: 'done' },    // done observado en sesión
    { id: 'op-6', type: 'sale_order', status: 'done' },    // done REHIDRATADO
    { id: '   ', type: 'sale_order', status: 'pending' },  // id vacío
    { id: 'op-5', type: 'gps', status: 'pending' },
  ];

  // Un done solo proyecta si su transición se observó en esta sesión: op-4 sí
  // (está en el set), op-6 no (rehidratado de otra sesión → sin tarjeta
  // fantasma aunque el refresco remoto falle).
  const sessionCompleted = new Set(['op-4']);
  const projectable = selectProjectableSaleItems(queue, sessionCompleted);
  assert.deepEqual(
    projectable.map((i: { id: string; status: string }) => `${i.id}:${i.status}`),
    ['op-1:pending', 'op-3:error', 'op-1:pending', 'op-4:done', '   :pending'],
  );

  assert.deepEqual(
    collectLocalSaleOperationIds(projectable),
    ['op-1', 'op-3', 'op-4'],
  );

  // Sin dones de sesión: ningún done proyecta ni carga ticket.
  const noneCompleted = selectProjectableSaleItems(queue, new Set());
  assert.deepEqual(
    collectLocalSaleOperationIds(noneCompleted),
    ['op-1', 'op-3'],
  );

  assert.deepEqual(collectLocalSaleOperationIds([]), []);
  assert.deepEqual(selectProjectableSaleItems([], new Set()), []);

  console.log('local sale tickets tests: ok');
}

void main();
