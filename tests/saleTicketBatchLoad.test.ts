import assert from 'node:assert/strict';

async function main() {
  // @ts-ignore -- Node 24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime.
    new URL('../src/services/saleTicketStorage.ts', import.meta.url).pathname
  );

  const { loadSaleTicketSnapshots } = module;

  const ticket = (saleId: string) => ({
    saleId,
    odooFolio: null,
    customerName: `Cliente ${saleId}`,
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    paymentLabel: 'Contado',
    createdAt: '2026-07-24T15:00:00',
    lines: [],
    subtotal: 10,
    total: 10,
    totalKg: 1,
  });

  const calls: string[] = [];
  const loader = async (saleId: string) => {
    calls.push(saleId);
    if (saleId === 'missing') return null;
    if (saleId === 'broken') throw new Error('storage corrupted');
    return ticket(saleId);
  };

  // Deduplica, ignora vacíos, una lectura rota no tira las demás,
  // y el mapa se indexa por el ID original de la cola.
  const map = await loadSaleTicketSnapshots(
    ['op-1', 'op-1', '  ', 'missing', 'broken', 'op-2'],
    loader,
  );

  assert.deepEqual(calls, ['op-1', 'missing', 'broken', 'op-2']);
  assert.equal(map.size, 2);
  assert.equal(map.get('op-1')?.customerName, 'Cliente op-1');
  assert.equal(map.get('op-2')?.customerName, 'Cliente op-2');
  assert.equal(map.has('missing'), false);
  assert.equal(map.has('broken'), false);

  const empty = await loadSaleTicketSnapshots([], loader);
  assert.equal(empty.size, 0);

  console.log('sale ticket batch load tests: ok');
}

void main();
