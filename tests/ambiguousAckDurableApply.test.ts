/**
 * INV-1B durable ACK apply — concurrent writers + crash boundaries.
 *
 * These tests exercise the serialized persistence coordinator + ACK intent
 * application (the real lost-update surface), not only pure helpers.
 *
 * Note: `selectPersistableQueue` omits `status === 'done'`. After a successful
 * durable ACK apply, the durable snapshot therefore no longer contains that
 * row; the durable effect is "no longer ambiguous in sync:queue". Memory still
 * holds done+_serverAcknowledgedAtMs until restart / later mutation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyServerAckIntentsToQueue,
  keepLedgerOperationIdsForSnapshot,
  reconcileAmbiguousLedgerOperations,
  runReconcileAmbiguousLedgerFlight,
  type AmbiguousAckReconcilePorts,
  type AmbiguousQueueItem,
  type ServerAckIntent,
} from '../src/services/ambiguousAckReconcile.ts';
import { createSerializedPersistenceCoordinator } from '../src/services/serializedTaskRunner.ts';
import { selectPersistableQueue } from '../src/services/syncQueuePersistence.ts';
import {
  applySaleStockViaLedger,
} from '../src/services/inventoryLedgerAdapters.ts';
import {
  createMemoryLedgerPorts,
  rebaseLedgerFromServerSnapshot,
} from '../src/services/inventoryLedgerLogic.ts';
import { migrateLegacySellableSnapshot } from '../src/domain/inventory/ledgerState.ts';

const OP_A = '00000000-0000-4000-8000-0000000000a1';
const OP_B = '00000000-0000-4000-8000-0000000000b1';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function saleRow(
  id: string,
  status: AmbiguousQueueItem['status'],
  extra: Record<string, unknown> = {},
): AmbiguousQueueItem {
  return {
    id,
    type: 'sale_order',
    status,
    payload: {
      operation_id: id,
      partner_id: 10,
      stop_id: 5,
      _ledgerApplied: true,
      ...extra,
    },
  };
}

function cloneQueue(queue: AmbiguousQueueItem[]): AmbiguousQueueItem[] {
  return queue.map((item) => ({
    ...item,
    payload: { ...item.payload },
  }));
}

function createAckQueueHarness(
  initial: AmbiguousQueueItem[],
  write?: (snapshot: AmbiguousQueueItem[], index: number) => Promise<void>,
) {
  let memory = cloneQueue(initial);
  let storage = cloneQueue(selectPersistableQueue(initial) as AmbiguousQueueItem[]);
  const writes: AmbiguousQueueItem[][] = [];
  const coordinator = createSerializedPersistenceCoordinator<
    AmbiguousQueueItem[],
    AmbiguousQueueItem[]
  >({
    read: () => memory,
    select: (q) => selectPersistableQueue(q as never) as AmbiguousQueueItem[],
    write: async (snapshot) => {
      const captured = cloneQueue(snapshot);
      const index = writes.push(captured) - 1;
      await write?.(captured, index);
      storage = captured;
    },
    publish: (next) => {
      memory = next;
    },
  });

  async function applyServerAcknowledgementsDurably(intents: ServerAckIntent[]): Promise<void> {
    if (intents.length === 0) return;
    await coordinator.transformAndPersist((queue) =>
      applyServerAckIntentsToQueue(queue, intents),
    );
  }

  return {
    coordinator,
    applyServerAcknowledgementsDurably,
    getMemory: () => cloneQueue(memory),
    setMemory: (next: AmbiguousQueueItem[]) => {
      memory = cloneQueue(next);
    },
    getStorage: () => cloneQueue(storage),
    writes,
    restartFromDurable: () => {
      memory = cloneQueue(storage);
    },
  };
}

describe('INV-1B durable ACK + concurrent queue writers', () => {
  it('A: reconcile resolves only after durable ACK write; then snapshot may begin', async () => {
    const writeStarted = deferred<void>();
    const writeGate = deferred<void>();
    const harness = createAckQueueHarness(
      [saleRow(OP_A, 'error')],
      async (_snapshot, index) => {
        if (index === 0) {
          writeStarted.resolve();
          await writeGate.promise;
        }
      },
    );

    const networkGate = deferred<void>();
    let checkCalls = 0;
    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 7_000,
      checkSaleDuplicate: async () => {
        checkCalls += 1;
        await networkGate.promise;
        return { duplicate: true };
      },
      replayGift: async () => undefined,
      classifyGiftError: () => 'ambiguous',
      replayExchange: async () => undefined,
      classifyExchangeError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };

    let reconcileSettled = false;
    let snapshotStarted = false;
    const reconcilePromise = (async () => {
      const intentsResult = await reconcileAmbiguousLedgerOperations(
        harness.getMemory(),
        ports,
      );
      await harness.applyServerAcknowledgementsDurably(intentsResult.intents);
      reconcileSettled = true;
      snapshotStarted = true;
    })();

    await Promise.resolve();
    assert.equal(checkCalls, 1);
    assert.equal(reconcileSettled, false);
    assert.equal(harness.writes.length, 0);

    networkGate.resolve();
    await writeStarted.promise;
    assert.equal(reconcileSettled, false, 'must not resolve before durable write completes');
    assert.equal(snapshotStarted, false);
    assert.equal(
      harness.getMemory()[0]!.payload._serverAcknowledgedAtMs,
      undefined,
      'memory must not publish ACK before durable write',
    );

    writeGate.resolve();
    await reconcilePromise;
    assert.equal(reconcileSettled, true);
    assert.equal(snapshotStarted, true);
    // Durable queue omits done rows; ambiguous A must be gone.
    assert.equal(harness.getStorage().some((i) => i.id === OP_A), false);
    assert.equal(harness.getMemory()[0]!.payload._serverAcknowledgedAtMs, 7_000);
    assert.equal(harness.getMemory()[0]!.status, 'done');
  });

  it('B: persistence failure → no durable/memory ACK; movement kept', async () => {
    const harness = createAckQueueHarness(
      [saleRow(OP_A, 'error')],
      async () => {
        throw new Error('disk full');
      },
    );

    const intents: ServerAckIntent[] = [{
      item_id: OP_A,
      operation_id: OP_A,
      type: 'sale_order',
      acknowledged_at_ms: 8_000,
    }];

    await assert.rejects(
      () => harness.applyServerAcknowledgementsDurably(intents),
      /disk full/,
    );

    assert.equal(harness.getMemory()[0]!.status, 'error');
    assert.equal(harness.getMemory()[0]!.payload._serverAcknowledgedAtMs, undefined);
    assert.equal(harness.getStorage()[0]!.payload._serverAcknowledgedAtMs, undefined);

    const keep = keepLedgerOperationIdsForSnapshot(harness.getMemory(), Date.now());
    assert.equal(keep.has(OP_A), true);

    const ledger = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 10: 10 }, 'v0', 't0'),
    );
    await applySaleStockViaLedger({
      operationId: OP_A,
      lines: [{ product_id: 10, qty: 3 }],
      ports: ledger,
    });
    await rebaseLedgerFromServerSnapshot(ledger, { 10: 7 }, keep, 'after-fail');
    assert.equal(ledger._state?.movements.length, 1, 'movement retained without durable ACK');
    assert.equal(ledger._sellable[10], 4);
  });

  it('C: concurrent enqueue during network → B preserved after ACK A', async () => {
    const networkGate = deferred<void>();
    const harness = createAckQueueHarness([saleRow(OP_A, 'error')]);

    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 9_000,
      checkSaleDuplicate: async () => {
        await networkGate.promise;
        return { duplicate: true };
      },
      replayGift: async () => undefined,
      classifyGiftError: () => 'ambiguous',
      replayExchange: async () => undefined,
      classifyExchangeError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };

    const reconcilePromise = (async () => {
      const result = await reconcileAmbiguousLedgerOperations(harness.getMemory(), ports);
      await harness.applyServerAcknowledgementsDurably(result.intents);
    })();

    await Promise.resolve();
    harness.setMemory([...harness.getMemory(), saleRow(OP_B, 'pending')]);
    void harness.coordinator.persistCurrent();

    networkGate.resolve();
    await reconcilePromise;
    await harness.coordinator.persistCurrent();

    const finalMem = harness.getMemory();
    assert.equal(finalMem.length, 2);
    const a = finalMem.find((i) => i.id === OP_A)!;
    const b = finalMem.find((i) => i.id === OP_B)!;
    assert.equal(a.status, 'done');
    assert.equal(a.payload._serverAcknowledgedAtMs, 9_000);
    assert.equal(b.status, 'pending');
    assert.equal(b.payload._serverAcknowledgedAtMs, undefined);
    // Durable: A done filtered out; B must remain.
    assert.deepEqual(harness.getStorage().map((i) => i.id), [OP_B]);
  });

  it('D: concurrent unrelated status change on B is preserved', async () => {
    const networkGate = deferred<void>();
    const harness = createAckQueueHarness([
      saleRow(OP_A, 'error'),
      saleRow(OP_B, 'pending'),
    ]);

    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 10_000,
      checkSaleDuplicate: async (payload) => {
        await networkGate.promise;
        return { duplicate: payload.operation_id === OP_A };
      },
      replayGift: async () => undefined,
      classifyGiftError: () => 'ambiguous',
      replayExchange: async () => undefined,
      classifyExchangeError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };

    const reconcilePromise = (async () => {
      const result = await reconcileAmbiguousLedgerOperations(harness.getMemory(), ports);
      await harness.applyServerAcknowledgementsDurably(result.intents);
    })();

    await Promise.resolve();
    harness.setMemory(
      harness.getMemory().map((item) =>
        item.id === OP_B
          ? { ...item, status: 'error', error_message: 'network blip', next_retry_at: 99 }
          : item,
      ),
    );

    networkGate.resolve();
    await reconcilePromise;

    const b = harness.getMemory().find((i) => i.id === OP_B)!;
    assert.equal(b.status, 'error');
    assert.equal(b.error_message, 'network blip');
    assert.equal(b.next_retry_at, 99);
    const a = harness.getMemory().find((i) => i.id === OP_A)!;
    assert.equal(a.status, 'done');
    assert.equal(a.payload._serverAcknowledgedAtMs, 10_000);
  });

  it('E: same operation completes via processQueue while reconcile in-flight → one logical ACK', async () => {
    const networkGate = deferred<void>();
    const harness = createAckQueueHarness([saleRow(OP_A, 'syncing')]);

    const ports: AmbiguousAckReconcilePorts = {
      nowMs: () => 11_000,
      checkSaleDuplicate: async () => {
        await networkGate.promise;
        return { duplicate: true };
      },
      replayGift: async () => undefined,
      classifyGiftError: () => 'ambiguous',
      replayExchange: async () => undefined,
      classifyExchangeError: () => 'ambiguous',
      classifySaleCheckError: () => 'ambiguous',
    };

    const reconcilePromise = (async () => {
      const result = await reconcileAmbiguousLedgerOperations(harness.getMemory(), ports);
      await harness.applyServerAcknowledgementsDurably(result.intents);
    })();

    await Promise.resolve();
    harness.setMemory([
      saleRow(OP_A, 'done', { _serverAcknowledgedAtMs: 10_500 }),
    ]);

    networkGate.resolve();
    await reconcilePromise;

    const a = harness.getMemory()[0]!;
    assert.equal(a.status, 'done');
    assert.equal(
      a.payload._serverAcknowledgedAtMs,
      10_500,
      'must not downgrade / overwrite earlier processQueue ACK',
    );
  });

  it('F: two reconcile callers share single-flight', async () => {
    const networkGate = deferred<void>();
    let checkCalls = 0;
    const harness = createAckQueueHarness([saleRow(OP_A, 'error')]);
    const run = () =>
      runReconcileAmbiguousLedgerFlight(async () => {
        const result = await reconcileAmbiguousLedgerOperations(harness.getMemory(), {
          nowMs: () => 12_000,
          checkSaleDuplicate: async () => {
            checkCalls += 1;
            await networkGate.promise;
            return { duplicate: true };
          },
          replayGift: async () => undefined,
          classifyGiftError: () => 'ambiguous',
          replayExchange: async () => undefined,
          classifyExchangeError: () => 'ambiguous',
          classifySaleCheckError: () => 'ambiguous',
        });
        await harness.applyServerAcknowledgementsDurably(result.intents);
        return result;
      });

    const p1 = run();
    const p2 = run();
    await Promise.resolve();
    assert.equal(checkCalls, 1);
    networkGate.resolve();
    const [a, b] = await Promise.all([p1, p2]);
    assert.deepEqual(a.acknowledgedIds, b.acknowledgedIds);
    assert.equal(harness.getMemory()[0]!.payload._serverAcknowledgedAtMs, 12_000);
  });

  it('G: crash after durable ACK before truck_stock → effect survives; drop only after fresh snapshot', async () => {
    const harness = createAckQueueHarness([saleRow(OP_A, 'error')]);
    await harness.applyServerAcknowledgementsDurably([{
      item_id: OP_A,
      operation_id: OP_A,
      type: 'sale_order',
      acknowledged_at_ms: 100,
    }]);

    assert.equal(harness.getMemory()[0]!.payload._serverAcknowledgedAtMs, 100);
    assert.equal(harness.getStorage().some((i) => i.id === OP_A), false);

    harness.restartFromDurable();
    // Done rows are not rehydrated; op is no longer ambiguous.
    assert.equal(harness.getMemory().some((i) => i.id === OP_A), false);

    const ledger = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 10: 10 }, 'v0', 't0'),
    );
    await applySaleStockViaLedger({
      operationId: OP_A,
      lines: [{ product_id: 10, qty: 3 }],
      ports: ledger,
    });
    assert.equal(ledger._state?.movements.length, 1);

    // Before any post-restart snapshot rebase, movement still lives in ledger.
    assert.equal(ledger._sellable[10], 7);

    // Fresh truck_stock after durable ACK (client fence): movement removed once.
    const keepPost = keepLedgerOperationIdsForSnapshot(harness.getMemory(), 200);
    assert.equal(keepPost.has(OP_A), false);
    await rebaseLedgerFromServerSnapshot(ledger, { 10: 7 }, keepPost, 'post-restart');
    assert.equal(ledger._state?.movements.length, 0);
    assert.equal(ledger._sellable[10], 7);
  });

  it('H: crash before durable ACK write → remains ambiguous after restart', async () => {
    const writeStarted = deferred<void>();
    const writeGate = deferred<void>();
    const harness = createAckQueueHarness(
      [saleRow(OP_A, 'error')],
      async (_snapshot, index) => {
        if (index === 0) {
          writeStarted.resolve();
          await writeGate.promise;
        }
      },
    );

    const applyPromise = harness.applyServerAcknowledgementsDurably([{
      item_id: OP_A,
      operation_id: OP_A,
      type: 'sale_order',
      acknowledged_at_ms: 13_000,
    }]);

    await writeStarted.promise;
    writeGate.reject(new Error('crash'));
    await assert.rejects(() => applyPromise);

    harness.restartFromDurable();
    assert.equal(harness.getMemory()[0]!.status, 'error');
    assert.equal(harness.getMemory()[0]!.payload._serverAcknowledgedAtMs, undefined);
    const keep = keepLedgerOperationIdsForSnapshot(harness.getMemory(), 99_000);
    assert.equal(keep.has(OP_A), true);
  });

  it('runtime contract: await durable apply before resolve (no fire-and-forget)', async () => {
    const writeGate = deferred<void>();
    const writeStarted = deferred<void>();
    let durableAck = false;

    const applyAcknowledgementsDurably = async (intents: ServerAckIntent[]) => {
      writeStarted.resolve();
      await writeGate.promise;
      durableAck = intents.length > 0;
    };

    let settled = false;
    const networkGate = deferred<void>();
    const p = runReconcileAmbiguousLedgerFlight(async () => {
      const result = await reconcileAmbiguousLedgerOperations(
        [saleRow(OP_A, 'error')],
        {
          nowMs: () => 14_000,
          checkSaleDuplicate: async () => {
            await networkGate.promise;
            return { duplicate: true };
          },
          replayGift: async () => undefined,
          classifyGiftError: () => 'ambiguous',
          replayExchange: async () => undefined,
          classifyExchangeError: () => 'ambiguous',
          classifySaleCheckError: () => 'ambiguous',
        },
      );
      if (result.intents.length > 0) {
        await applyAcknowledgementsDurably(result.intents);
      }
      settled = true;
      return result;
    });

    networkGate.resolve();
    await writeStarted.promise;
    assert.equal(settled, false);
    assert.equal(durableAck, false);
    writeGate.resolve();
    await p;
    assert.equal(settled, true);
    assert.equal(durableAck, true);
  });
});

describe('INV-1B fail-safe keep-set without durable ACK', () => {
  it('ambiguous durable queue keeps movement; memory-only ACK would be unsafe', () => {
    const durableOnly = [saleRow(OP_A, 'error')];
    const keep = keepLedgerOperationIdsForSnapshot(durableOnly, Date.now());
    assert.equal(keep.has(OP_A), true);

    const unsafeMemory = [
      saleRow(OP_A, 'done', { _serverAcknowledgedAtMs: 1 }),
    ];
    assert.equal(
      keepLedgerOperationIdsForSnapshot(unsafeMemory, 2).has(OP_A),
      false,
      'memory ACK would allow drop — must not publish without durable success',
    );
  });
});
