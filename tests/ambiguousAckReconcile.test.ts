/**
 * INV-1B ambiguous acknowledgement reconciliation tests.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyServerAckIntentsToQueue,
  keepLedgerOperationIdsForSnapshot,
  reconcileAmbiguousLedgerOperations,
  runReconcileAmbiguousLedgerFlight,
  withServerAcknowledgedAtMs,
  type AmbiguousAckReconcilePorts,
  type AmbiguousQueueItem,
  type ServerAckIntent,
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

describe('INV-1B reconcileAmbiguousLedgerOperations (ACK intents)', () => {
  it('CASE C: committed check → ACK intent; no stock heuristic; ackAt after confirm', async () => {
    const timestamps: number[] = [];
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => {
        timestamps.push(2_000 + timestamps.length);
        return timestamps[timestamps.length - 1]!;
      },
      checkSaleDuplicate: async () => {
        assert.equal(timestamps.length, 0, 'ack timestamp must not be taken before authority');
        return { duplicate: true };
      },
      replayGift: async () => {
        throw new Error('gift not called');
      },
      classifyGiftError: () => 'ambiguous',
      replayExchange: async () => undefined,
      classifyExchangeError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };
    const result = await reconcileAmbiguousLedgerOperations([saleItem()], ports);
    assert.deepEqual(result.acknowledgedIds, [OP]);
    assert.equal(result.intents.length, 1);
    assert.equal(result.intents[0]!.acknowledged_at_ms, 2_000);
    assert.equal(timestamps.length, 1);
  });

  it('CASE D: not_found → no intent', async () => {
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 3_000,
      checkSaleDuplicate: async () => ({ duplicate: false }),
      replayGift: async () => undefined,
      classifyGiftError: () => 'ambiguous',
      replayExchange: async () => undefined,
      classifyExchangeError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };
    const result = await reconcileAmbiguousLedgerOperations([saleItem()], ports);
    assert.deepEqual(result.acknowledgedIds, []);
    assert.deepEqual(result.intents, []);
  });

  it('CASE G: reconcile timeout → no intent', async () => {
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 4_000,
      checkSaleDuplicate: async () => {
        throw Object.assign(new Error('timeout'), { code: 'timeout' });
      },
      replayGift: async () => undefined,
      classifyGiftError: () => 'ambiguous',
      replayExchange: async () => undefined,
      classifyExchangeError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };
    const result = await reconcileAmbiguousLedgerOperations([saleItem()], ports);
    assert.deepEqual(result.acknowledgedIds, []);
    assert.deepEqual(result.intents, []);
  });

  it('gift replay committed → ACK intent (same operation, no new id)', async () => {
    const giftOp = '00000000-0000-4000-8000-0000000000g1';
    let replayed = 0;
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 5_000,
      checkSaleDuplicate: async () => ({ duplicate: false }),
      replayGift: async () => {
        replayed += 1;
      },
      classifyGiftError: () => 'ambiguous',
      replayExchange: async () => undefined,
      classifyExchangeError: () => 'ambiguous',
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
    assert.equal(result.intents[0]!.operation_id, giftOp);
    assert.equal(result.intents[0]!.acknowledged_at_ms, 5_000);
  });

  it('consignment_* exact replay committed → ACK intent (same UUID)', async () => {
    const op = '00000000-0000-4000-8000-0000000000c9';
    const replayed: string[] = [];
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 6_000,
      checkSaleDuplicate: async () => ({ duplicate: false }),
      replayGift: async () => undefined,
      classifyGiftError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
      replayConsignment: async (item) => {
        replayed.push(item.type);
      },
      classifyConsignmentError: () => 'ambiguous',
    };
    for (const type of ['consignment_create', 'consignment_visit', 'consignment_close'] as const) {
      replayed.length = 0;
      const result = await reconcileAmbiguousLedgerOperations(
        [{
          id: op,
          type,
          status: 'error',
          payload: { operation_id: op, partner_id: 1, consignment_id: 2, _ledgerApplied: true },
        }],
        ports,
      );
      assert.deepEqual(replayed, [type]);
      assert.deepEqual(result.acknowledgedIds, [op]);
      assert.equal(result.intents[0]!.type, type);
      assert.equal(result.intents[0]!.operation_id, op);
    }
  });

  it('consignment ambiguous replay failure → keep (no ACK)', async () => {
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 7_000,
      checkSaleDuplicate: async () => ({ duplicate: false }),
      replayGift: async () => undefined,
      classifyGiftError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
      replayConsignment: async () => {
        throw Object.assign(new Error('timeout'), { code: 'timeout' });
      },
      classifyConsignmentError: () => 'ambiguous',
    };
    const result = await reconcileAmbiguousLedgerOperations(
      [{
        id: OP,
        type: 'consignment_create',
        status: 'pending',
        payload: { operation_id: OP, partner_id: 1, _ledgerApplied: true },
      }],
      ports,
    );
    assert.deepEqual(result.intents, []);
  });

  it('two simultaneous flights share one logical reconcile', async () => {
    let calls = 0;
    const run = () =>
      runReconcileAmbiguousLedgerFlight(async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return {
          acknowledgedIds: ['x'],
          intents: [{
            item_id: 'x',
            operation_id: 'x',
            type: 'sale_order',
            acknowledged_at_ms: 1,
          }],
        };
      });
    const [a, b] = await Promise.all([run(), run()]);
    assert.equal(calls, 1);
    assert.deepEqual(a.acknowledgedIds, b.acknowledgedIds);
  });
});

describe('INV-1B applyServerAckIntentsToQueue', () => {
  const intent = (overrides: Partial<ServerAckIntent> = {}): ServerAckIntent => ({
    item_id: OP,
    operation_id: OP,
    type: 'sale_order',
    acknowledged_at_ms: 9_000,
    ...overrides,
  });

  it('applies ACK to pending/error/syncing; preserves unrelated rows', () => {
    const other: AmbiguousQueueItem = {
      id: 'other',
      type: 'payment',
      status: 'pending',
      payload: { amount: 1 },
    };
    const next = applyServerAckIntentsToQueue(
      [saleItem({ status: 'syncing' }), other],
      [intent()],
    );
    assert.equal(next[0]!.status, 'done');
    assert.equal(next[0]!.payload._serverAcknowledgedAtMs, 9_000);
    assert.equal(next[1]!.status, 'pending');
    assert.deepEqual(next[1]!.payload, { amount: 1 });
  });

  it('DONE same operation is idempotent; fills missing ACK only', () => {
    const already = applyServerAckIntentsToQueue(
      [saleItem({
        status: 'done',
        payload: withServerAcknowledgedAtMs(
          { operation_id: OP, partner_id: 10 },
          1_111,
        ),
      })],
      [intent({ acknowledged_at_ms: 9_999 })],
    );
    assert.equal(already[0]!.payload._serverAcknowledgedAtMs, 1_111);

    const missing = applyServerAckIntentsToQueue(
      [saleItem({ status: 'done', payload: { operation_id: OP, partner_id: 10 } })],
      [intent({ acknowledged_at_ms: 9_999 })],
    );
    assert.equal(missing[0]!.payload._serverAcknowledgedAtMs, 9_999);
  });

  it('DEAD same operation is not resurrected', () => {
    const next = applyServerAckIntentsToQueue(
      [saleItem({ status: 'dead' })],
      [intent()],
    );
    assert.equal(next[0]!.status, 'dead');
    assert.equal(next[0]!.payload._serverAcknowledgedAtMs, undefined);
  });

  it('operation_id mismatch does not mutate', () => {
    const next = applyServerAckIntentsToQueue(
      [saleItem()],
      [intent({ operation_id: 'different-op' })],
    );
    assert.equal(next[0]!.status, 'error');
    assert.equal(next[0]!.payload._serverAcknowledgedAtMs, undefined);
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
    const staleKeep = keepLedgerOperationIdsForSnapshot(queueAfterAck, 50);
    await rebaseLedgerFromServerSnapshot(ports, { 10: 7 }, staleKeep, 'stale');
    assert.equal(ports._sellable[10], 4, 'stale snapshot + keep still double-applies until fresh');

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
    assert.equal(ports._sellable[10], 7);
    assert.equal(ports._state?.movements.length, 1);

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
    const queue = [
      saleItem({
        status: 'done',
        payload: withServerAcknowledgedAtMs(
          { operation_id: OP, partner_id: 10, _ledgerApplied: true },
          500,
        ),
      }),
    ];
    const keep = keepLedgerOperationIdsForSnapshot(queue, 400);
    await rebaseLedgerFromServerSnapshot(ports, { 10: 10 }, keep, 'pre-ack');
    assert.equal(ports._sellable[10], 7, 'must keep local -3 until post-ack snapshot');
  });
});
