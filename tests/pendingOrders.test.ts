/**
 * Resumen de pedidos sin sincronizar (badge de ruta).
 */
import assert from 'node:assert/strict';

interface Mod {
  summarizePendingOrders: (q: Array<{ type: string; status: string }>) => {
    pending: number; failed: number; total: number;
  };
  describePendingOrdersBanner: (s: { pending: number; failed: number; total: number }) => string | null;
}

function run(m: Mod) {
  const q = [
    { type: 'sale_order', status: 'pending' },
    { type: 'sale_order', status: 'syncing' },
    { type: 'sale_order', status: 'error' },
    { type: 'sale_order', status: 'done' },   // no cuenta
    { type: 'checkout', status: 'pending' },   // no es pedido
    { type: 'gps', status: 'pending' },
  ];
  const s = m.summarizePendingOrders(q);
  assert.equal(s.pending, 2, 'pending+syncing');
  assert.equal(s.failed, 1, 'error+dead');
  assert.equal(s.total, 3);

  // Banner
  assert.equal(m.describePendingOrdersBanner({ pending: 0, failed: 0, total: 0 }), null, 'sin pedidos → null');
  assert.match(m.describePendingOrdersBanner(s) ?? '', /pendiente/i);
  assert.match(m.describePendingOrdersBanner(s) ?? '', /error/i);
  assert.match(m.describePendingOrdersBanner({ pending: 1, failed: 0, total: 1 }) ?? '', /1 pendiente/i);

  // Cola vacía / sin sale_order.
  assert.equal(m.summarizePendingOrders([]).total, 0);
  assert.equal(m.summarizePendingOrders([{ type: 'checkout', status: 'error' }]).total, 0);

  console.log('pending orders summary tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/pendingOrders.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
