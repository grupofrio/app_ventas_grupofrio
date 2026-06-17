/**
 * Resumen de pedidos sin sincronizar (badge de ruta).
 */
import assert from 'node:assert/strict';

interface Mod {
  summarizePendingOrders: (q: Array<{ type: string; status: string }>) => {
    pending: number; failed: number; total: number;
  };
  describePendingOrdersBanner: (s: { pending: number; failed: number; total: number }) => string | null;
  describeSaleOrderItem: (item: { type: string; status: string; payload?: any; id?: string }) => {
    customerName: string | null; total: number | null; statusLabel: string; tone: string; operationId: string | null;
  } | null;
  buildStopOrderStatusMap: (q: Array<{ type: string; status: string; payload?: any }>) => Record<number, string>;
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

  // ── describeSaleOrderItem (Sync: cliente + total + estado) ───────────────
  const pendItem = { type: 'sale_order', status: 'pending', id: 'op-1',
    payload: { _clientCustomerName: 'Abarrotes Lupita', _clientTotal: 70, _operationId: 'op-1', stop_id: 5 } };
  const d = m.describeSaleOrderItem(pendItem)!;
  assert.equal(d.customerName, 'Abarrotes Lupita');
  assert.equal(d.total, 70);
  assert.match(d.statusLabel, /pendiente/i);
  assert.equal(d.tone, 'pending');
  // enviado / error
  assert.match(m.describeSaleOrderItem({ ...pendItem, status: 'done' })!.statusLabel, /enviada/i);
  assert.equal(m.describeSaleOrderItem({ ...pendItem, status: 'done' })!.tone, 'sent');
  assert.match(m.describeSaleOrderItem({ ...pendItem, status: 'error' })!.statusLabel, /error/i);
  assert.equal(m.describeSaleOrderItem({ ...pendItem, status: 'dead' })!.tone, 'error');
  // no-sale → null (no contamina)
  assert.equal(m.describeSaleOrderItem({ type: 'gps', status: 'pending', payload: {} }), null);
  assert.equal(m.describeSaleOrderItem({ type: 'gift', status: 'pending', payload: {} }), null);
  // sin metadata client → null seguro
  const noMeta = m.describeSaleOrderItem({ type: 'sale_order', status: 'pending', payload: {} })!;
  assert.equal(noMeta.customerName, null);
  assert.equal(noMeta.total, null);

  // ── buildStopOrderStatusMap (badge por stop) ─────────────────────────────
  const map = m.buildStopOrderStatusMap([
    { type: 'sale_order', status: 'pending', payload: { stop_id: 1 } },
    { type: 'sale_order', status: 'error', payload: { stop_id: 2 } },
    { type: 'sale_order', status: 'done', payload: { stop_id: 3 } },   // no badge
    { type: 'sale_order', status: 'pending', payload: { stop_id: 2 } }, // error gana en stop 2
    { type: 'gps', status: 'pending', payload: { stop_id: 1 } },        // no contamina
    { type: 'checkout', status: 'error', payload: { stop_id: 9 } },     // no es pedido
  ]);
  assert.equal(map[1], 'pending', 'stop 1 pendiente');
  assert.equal(map[2], 'error', 'stop 2 error gana sobre pending');
  assert.equal(map[3], undefined, 'stop done sin badge');
  assert.equal(map[9], undefined, 'checkout no genera badge de pedido');

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
