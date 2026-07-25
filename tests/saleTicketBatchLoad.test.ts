import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadSaleTicketSnapshots,
} from '../src/services/saleTicketStorage.ts';
import {
  parseSaleTicketSnapshot,
  type SaleTicketSnapshot,
} from '../src/services/saleTicket.ts';

function ticket(saleId: string): SaleTicketSnapshot {
  return {
    saleId,
    origin: 'local',
    customerName: `Cliente ${saleId}`,
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    paymentLabel: 'Efectivo',
    createdAt: '2026-07-25T10:00:00.000Z',
    lines: [{
      productId: 7,
      productName: 'Hielo',
      qty: 2,
      unitPrice: 50,
      lineTotal: 100,
      weight: 5,
    }],
    subtotal: 100,
    total: 100,
    totalKg: 10,
  };
}

test('batch loading trims and deduplicates reads while retaining the first queue id as map key', async () => {
  const calls: string[] = [];
  const snapshots = await loadSaleTicketSnapshots(
    [' sale-a ', 'sale-a', '', '   ', 'sale-b', ' sale-b '],
    async (saleId) => {
      calls.push(saleId);
      return ticket(saleId);
    },
  );

  assert.deepEqual(calls, ['sale-a', 'sale-b']);
  assert.deepEqual([...snapshots.keys()], [' sale-a ', 'sale-b']);
  assert.equal(snapshots.get(' sale-a ')?.saleId, 'sale-a');
  assert.equal(snapshots.get('sale-b')?.saleId, 'sale-b');
  assert.equal(snapshots.has('sale-a'), false);
});

test('one rejected or missing read does not drop other loaded tickets', async () => {
  const snapshots = await loadSaleTicketSnapshots(
    ['sale-ok-1', 'sale-failed', 'sale-missing', 'sale-ok-2'],
    async (saleId) => {
      if (saleId === 'sale-failed') throw new Error('storage unavailable');
      if (saleId === 'sale-missing') return null;
      return ticket(saleId);
    },
  );

  assert.deepEqual([...snapshots.keys()], ['sale-ok-1', 'sale-ok-2']);
  assert.equal(snapshots.get('sale-ok-1')?.saleId, 'sale-ok-1');
  assert.equal(snapshots.get('sale-ok-2')?.saleId, 'sale-ok-2');
});

test('batch loading retains legacy snapshots accepted by the existing parser', async () => {
  const current = ticket('sale-legacy');
  const legacy = {
    ...current,
    lines: current.lines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      qty: line.qty,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      weight: line.weight,
    })),
  };
  delete legacy.origin;

  const snapshots = await loadSaleTicketSnapshots(
    [' sale-legacy '],
    async (saleId) => parseSaleTicketSnapshot(legacy, saleId),
  );

  assert.deepEqual(snapshots.get(' sale-legacy '), legacy);
  assert.equal(snapshots.get(' sale-legacy ')?.origin, undefined);
  assert.equal(snapshots.get(' sale-legacy ')?.lines[0].priceSource, undefined);
});
