/**
 * INV-1B ambiguous acknowledgement reconciliation tests.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  keepLedgerOperationIdsForSnapshot,
  reconcileAmbiguousLedgerOperations,
  runReconcileAmbiguousLedgerFlight,
  withServerAcknowledgedAtMs,
  type AmbiguousAckReconcilePorts,
  type AmbiguousQueueItem,
} from '../src/services/ambiguousAckReconcile.ts';
import {
  applySaleStockViaLedger,
} from '../src/services/inventoryLedgerAdapters.ts';
import {
  createMemoryLedgerPorts,
  rebaseLedgerFromServerSnapshot,
} from '../src/services/inventoryLedgerLogic.ts';
import { migrateLegacySellableSnapshot } from '../src/domain/inventory/ledgerState.ts';

const OP = '00000000-0000-4000-8000-0000000000c1';

function saleItem(
  overrides: Partial<AmbiguousQueueItem> = {},
): AmbiguousQueueItem {
  return {
    id: OP,
    type: 'sale_order',
    status: 'error',
    payload: {
      operation_id: OP,
      partner_id: 10,
      stop_id: 5,
      _ledgerApplied: true,
    },
    ...overrides,
  };
}

describe('INV-1B keepLedgerOperationIdsForSnapshot', () => {
  it('CASE B/C: drops movement only when snapshotAt >= ackAt', () => {
    const queue = [
      saleItem({
        status: 'done',
        payload: withServerAcknowledgedAtMs(
          { operation_id: OP, partner_id: 10, _ledgerApplied: true },
          1_000,
        ),
      }),
    ];
    const before = keepLedgerOperationIdsForSnapshot(queue, 999);
    assert.equal(before.has(OP), true, 'stale pre-ACK snapshot must keep movement');
    const after = keepLedgerOperationIdsForSnapshot(queue, 1_000);
    assert.equal(after.has(OP), false, 'post-ACK snapshot may drop movement');
  });

  it('CASE A/D: unacked pending keeps movement', () => {
    const keep = keepLedgerOperationIdsForSnapshot([saleItem({ status: 'pending' })], 5_000);
    assert.equal(keep.has(OP), true);
  });

  it('legacy done without ackAt drops on any snapshot', () => {
    const keep = keepLedgerOperationIdsForSnapshot(
      [saleItem({ status: 'done', payload: { operation_id: OP, partner_id: 1 } })],
      1,
    );
    assert.equal(keep.has(OP), false);
  });

  it('dead never kept', () => {
    const keep = keepLedgerOperationIdsForSnapshot([saleItem({ status: 'dead' })], 9_000);
    assert.equal(keep.has(OP), false);
  });
});

describe('INV-1B reconcileAmbiguousLedgerOperations', () => {
  it('CASE C: committed check → ACK + done; no stock heuristic', async () => {
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 2_000,
      checkSaleDuplicate: async () => ({ duplicate: true }),
      replayGift: async () => {
        throw new Error('gift not called');
      },
      classifyGiftError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };
    const result = await reconcileAmbiguousLedgerOperations([saleItem()], ports);
    assert.deepEqual(result.acknowledgedIds, [OP]);
    assert.equal(result.queue[0].status, 'done');
    assert.equal(result.queue[0].payload._serverAcknowledgedAtMs, 2_000);
  });

  it('CASE D: not_found → movement retained (no ack)', async () => {
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 3_000,
      checkSaleDuplicate: async () => ({ duplicate: false }),
      replayGift: async () => undefined,
      classifyGiftError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };
    const result = await reconcileAmbiguousLedgerOperations([saleItem()], ports);
    assert.deepEqual(result.acknowledgedIds, []);
    assert.equal(result.queue[0].status, 'error');
    assert.equal(result.queue[0].payload._serverAcknowledgedAtMs, undefined);
  });

  it('CASE G: reconcile timeout → keep unacked', async () => {
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 4_000,
      checkSaleDuplicate: async () => {
        throw Object.assign(new Error('timeout'), { code: 'timeout' });
      },
      replayGift: async () => undefined,
      classifyGiftError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };
    const result = await reconcileAmbiguousLedgerOperations([saleItem()], ports);
    assert.deepEqual(result.acknowledgedIds, []);
    assert.equal(result.queue[0].payload._serverAcknowledgedAtMs, undefined);
  });

  it('gift replay committed → ACK', async () => {
    const giftOp = '00000000-0000-4000-8000-0000000000g1';
    let replayed = 0;
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 5_000,
      checkSaleDuplicate: async () => ({ duplicate: false }),
      replayGift: async () => {
        replayed += 1;
      },
      classifyGiftError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };
    const result = await reconcileAmbiguousLedgerOperations(
      [{
        id: giftOp,
        type: 'gift',
        status: 'pending',
        payload: {
          meta: { idempotency_key: giftOp },
          data: { partner_id: 1 },
          _ledgerApplied: true,
        },
      }],
      ports,
    );
    assert.equal(replayed, 1);
    assert.deepEqual(result.acknowledgedIds, [giftOp]);
    assert.equal(result.queue[0].payload._serverAcknowledgedAtMs, 5_000);
  });

  it('two simultaneous flights share one logical reconcile', async () => {
    let calls = 0;
    const run = () =>
      runReconcileAmbiguousLedgerFlight(async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return { acknowledgedIds: ['x'], queue: [] };
      });
    const [a, b] = await Promise.all([run(), run()]);
    assert.equal(calls, 1);
    assert.deepEqual(a.acknowledgedIds, b.acknowledgedIds);
  });
});

describe('INV-1B end-to-end projection protocol', () => {
  it('CASE C: ack + post-ack snapshot → visible 7 not 4', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 10: 10 }, 'v0', 't0'),
    );
    await applySaleStockViaLedger({
      operationId: OP,
      lines: [{ product_id: 10, qty: 3 }],
      ports,
    });
    assert.equal(ports._sellable[10], 7);

    const queueAfterAck = [
      saleItem({
        status: 'done',
        payload: withServerAcknowledgedAtMs(
          { operation_id: OP, partner_id: 10, _ledgerApplied: true },
          100,
        ),
      }),
    ];
    // Stale snapshot taken before ack must keep movement (no temporary inflation
    // if we incorrectly dropped — here we prove keep on stale).
    const staleKeep = keepLedgerOperationIdsForSnapshot(queueAfterAck, 50);
    await rebaseLedgerFromServerSnapshot(ports, { 10: 7 }, staleKeep, 'stale');
    assert.equal(ports._sellable[10], 4, 'stale snapshot + keep still double-applies until fresh');

    // Fresh post-ack snapshot drops movement.
    const freshKeep = keepLedgerOperationIdsForSnapshot(queueAfterAck, 200);
    await rebaseLedgerFromServerSnapshot(ports, { 10: 7 }, freshKeep, 'fresh');
    assert.equal(ports._sellable[10], 7);
    assert.equal(ports._state?.movements.length, 0);
  });

  it('CASE G then success: fresh snapshot fails conceptually → movement remains; later succeeds', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 10: 10 }, 'v0', 't0'),
    );
    await applySaleStockViaLedger({
      operationId: OP,
      lines: [{ product_id: 10, qty: 3 }],
      ports,
    });
    const queue = [
      saleItem({
        status: 'done',
        payload: withServerAcknowledgedAtMs(
          { operation_id: OP, partner_id: 10, _ledgerApplied: true },
          100,
        ),
      }),
    ];
    // Snapshot fetch failed → do not rebase (caller fail-safe). Movement stays.
    assert.equal(ports._sellable[10], 7);
    assert.equal(ports._state?.movements.length, 1);

    // Later fresh snapshot succeeds once.
    const keep = keepLedgerOperationIdsForSnapshot(queue, 200);
    await rebaseLedgerFromServerSnapshot(ports, { 10: 7 }, keep, 'later');
    assert.equal(ports._sellable[10], 7);
    assert.equal(ports._state?.movements.length, 0);
  });

  it('ACK before snapshot: do not drop on pre-ack snapshot (no temporary inflation)', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 10: 10 }, 'v0', 't0'),
    );
    await applySaleStockViaLedger({
      operationId: OP,
      lines: [{ product_id: 10, qty: 3 }],
      ports,
    });
    // Server not yet reflecting sale in this stale read (still 10).
    const queue = [
      saleItem({
        status: 'done',
        payload: withServerAcknowledgedAtMs(
          { operation_id: OP, partner_id: 10, _ledgerApplied: true },
          500,
        ),
      }),
    ];
    const keep = keepLedgerOperationIdsForSnapshot(queue, 400); // snapshot before ack
    await rebaseLedgerFromServerSnapshot(ports, { 10: 10 }, keep, 'pre-ack');
    assert.equal(ports._sellable[10], 7, 'must keep local -3 until post-ack snapshot');
  });
});
