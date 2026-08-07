import assert from 'node:assert/strict';

async function main() {
  // @ts-ignore -- Node 24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime.
    new URL('../src/services/localSaleTickets.ts', import.meta.url).pathname
  );

  const { collectLocalSaleOperationIds } = module;

  const queue = [
    { id: 'op-1', type: 'sale_order', status: 'pending' },
    { id: 'op-2', type: 'photo', status: 'pending' },
    { id: 'op-3', type: 'sale_order', status: 'error' },
    { id: 'op-1', type: 'sale_order', status: 'pending' }, // duplicado
    { id: 'op-4', type: 'sale_order', status: 'done' },    // done: tarjeta "Actualizando"
    { id: '   ', type: 'sale_order', status: 'pending' },  // id vacío
    { id: 'op-5', type: 'gps', status: 'pending' },
  ];

  assert.deepEqual(
    collectLocalSaleOperationIds(queue),
    ['op-1', 'op-3', 'op-4'],
  );

  assert.deepEqual(collectLocalSaleOperationIds([]), []);

  console.log('local sale tickets tests: ok');
}

void main();
