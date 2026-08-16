/**
 * Inventory ledger domain + persistence tests (POST-R1A closure).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildExchangeMovements,
  buildGiftMovements,
  buildReversalMovements,
  buildSaleMovements,
} from '../src/domain/inventory/buildMovements.ts';
import {
  appendMovements,
  createEmptyLedger,
  migrateLegacySellableSnapshot,
  projectSellable,
} from '../src/domain/inventory/ledgerState.ts';
import { projectInventory } from '../src/domain/inventory/projectInventory.ts';
import {
  saleMovementSlot,
  stableMovementId,
  stableReversalMovementId,
} from '../src/domain/inventory/stableIds.ts';
import {
  applySaleStockViaLedger,
  buildSaleLedgerMovements,
} from '../src/services/inventoryLedgerAdapters.ts';
import {
  commitSyncQueueAndLedger,
  createMemoryLedgerPorts,
  loadOrMigrateLedger,
  recordInventoryMovements,
} from '../src/services/inventoryLedgerLogic.ts';
import { assertEncryptedRecord, createEncryptedSessionStore } from '../src/services/encryptedStoreLogic.ts';

const OP = '00000000-0000-4000-8000-0000000000a1';
const OP_B = '00000000-0000-4000-8000-0000000000a2';
const M1 = '00000000-0000-4000-8000-0000000000b1';
const M2 = '00000000-0000-4000-8000-0000000000b2';
const M3 = '00000000-0000-4000-8000-0000000000b3';
const M4 = '00000000-0000-4000-8000-0000000000b4';

describe('projectInventory', () => {
  it('projects load → sale → gift → exchange delivery/damaged', () => {
    const snapshot = { '10': { sellable: 10 } };
    const ctx = {
      operation_id: OP,
      created_at: '2026-08-16T10:00:00.000Z',
      movement_ids: [M1, M2, M3, M4],
    };
    const sale = buildSaleMovements({ ...ctx, movement_ids: [M1], created_at: '2026-08-16T10:01:00.000Z' }, [
      { product_id: 10, qty: 2 },
    ]);
    const gift = buildGiftMovements({ ...ctx, movement_ids: [M2], created_at: '2026-08-16T10:02:00.000Z' }, [
      { product_id: 10, qty: 1 },
    ]);
    const exchange = buildExchangeMovements(
      { ...ctx, movement_ids: [M3, M4], created_at: '2026-08-16T10:03:00.000Z' },
      [{ product_id: 10, qty: 1 }],
      [],
      [{ product_id: 10, qty: 1 }],
    );
    const projection = projectInventory({
      initialSnapshot: snapshot,
      movements: [...sale, ...gift, ...exchange],
    });
    assert.equal(projection['10'].sellable, 6);
    assert.equal(projection['10'].damaged, 1);
    assert.equal(projection['10'].net_van_projection, 7);
    assert.equal(projection['10'].sellable_deficit, 0);
  });

  it('A: oversell creates exact deficit; reversal restores exact baseline', () => {
    const sale = buildSaleMovements(
      { operation_id: OP, created_at: '2026-08-16T10:00:00.000Z', movement_ids: [M1] },
      [{ product_id: 1, qty: 2 }],
    );
    const afterSale = projectInventory({
      initialSnapshot: { '1': { sellable: 1 } },
      movements: sale,
    });
    assert.equal(afterSale['1'].sellable, -1);
    assert.equal(afterSale['1'].net_van_projection, -1);
    assert.equal(afterSale['1'].sellable_deficit, 1);

    const reversals = buildReversalMovements(sale, {
      operation_id: OP,
      created_at: '2026-08-16T11:00:00.000Z',
    });
    const afterReversal = projectInventory({
      initialSnapshot: { '1': { sellable: 1 } },
      movements: [...sale, ...reversals],
    });
    assert.equal(afterReversal['1'].sellable, 1);
    assert.equal(afterReversal['1'].sellable_deficit, 0);
  });

  it('ignores duplicate movement_id (idempotent projection)', () => {
    const sale = buildSaleMovements(
      { operation_id: OP, created_at: '2026-08-16T10:00:00.000Z', movement_ids: [M1] },
      [{ product_id: 5, qty: 2 }],
    );
    const projection = projectInventory({
      initialSnapshot: { '5': { sellable: 10 } },
      movements: [...sale, ...sale],
    });
    assert.equal(projection['5'].sellable, 8);
  });

  it('reversal restores sellable without deleting original history', () => {
    const sale = buildSaleMovements(
      { operation_id: OP, created_at: '2026-08-16T10:00:00.000Z', movement_ids: [M1] },
      [{ product_id: 7, qty: 2 }],
    );
    const reversals = buildReversalMovements(sale, {
      operation_id: OP,
      created_at: '2026-08-16T11:00:00.000Z',
    });
    const movements = [...sale, ...reversals];
    assert.equal(movements.length, 2);
    assert.equal(movements[0].movement_type, 'sale');
    assert.equal(movements[1].movement_type, 'reversal');
    const projection = projectInventory({
      initialSnapshot: { '7': { sellable: 10 } },
      movements,
    });
    assert.equal(projection['7'].sellable, 10);
  });

  it('out-of-order created_at still yields stable totals', () => {
    const later = buildSaleMovements(
      { operation_id: OP, created_at: '2026-08-16T12:00:00.000Z', movement_ids: [M2] },
      [{ product_id: 1, qty: 1 }],
    );
    const earlier = buildSaleMovements(
      { operation_id: OP, created_at: '2026-08-16T09:00:00.000Z', movement_ids: [M1] },
      [{ product_id: 1, qty: 3 }],
    );
    const projection = projectInventory({
      initialSnapshot: { '1': { sellable: 10 } },
      movements: [...later, ...earlier],
    });
    assert.equal(projection['1'].sellable, 6);
  });
});

describe('stable movement identity', () => {
  it('G: same operation_id + slot → same movement_id', () => {
    const a = stableMovementId(OP, saleMovementSlot(42, 0));
    const b = stableMovementId(OP, saleMovementSlot(42, 0));
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f-]{36}$/i);
    assert.notEqual(a, stableMovementId(OP, saleMovementSlot(42, 1)));
  });

  it('B: adapter same operation twice → single stock effect', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 9: 10 }, 'seed', '2026-08-16T00:00:00.000Z'),
    );
    await applySaleStockViaLedger({
      operationId: OP,
      lines: [{ product_id: 9, qty: 3 }],
      ports,
    });
    await applySaleStockViaLedger({
      operationId: OP,
      lines: [{ product_id: 9, qty: 3 }],
      ports,
    });
    assert.equal(ports._state?.movements.length, 1);
    assert.equal(ports._sellable[9], 7);
  });
});

describe('ledger persistence barrier', () => {
  it('migrateLegacySellableSnapshot folds displays into baseline', () => {
    const state = migrateLegacySellableSnapshot({ 3: 4, 9: 1 }, 'v1', '2026-08-16T00:00:00.000Z');
    assert.equal(state.movements.length, 0);
    assert.equal(state.snapshot['3']?.sellable, 4);
  });

  it('J: legacy migration once-only after movements exist', async () => {
    const ports = createMemoryLedgerPorts(createEmptyLedger('tmp', '2026-08-16T00:00:00.000Z'));
    ports._state = null;
    ports._sellable = { 5: 10 };
    await loadOrMigrateLedger(ports);
    assert.equal(
      (ports._state as { snapshot: Record<string, { sellable?: number }> } | null)?.snapshot['5']?.sellable,
      10,
    );

    const sale = buildSaleLedgerMovements({
      operationId: OP,
      lines: [{ product_id: 5, qty: 2 }],
      createdAt: '2026-08-16T10:00:00.000Z',
    });
    await recordInventoryMovements(sale, ports);
    assert.equal(ports._sellable[5], 8);

    // Simulate display already mutated + "restart" that still has ledger on disk.
    ports._sellable = { 5: 8 };
    const { state } = await loadOrMigrateLedger(ports);
    assert.equal(state.movements.length, 1);
    assert.equal(state.snapshot['5']?.sellable, 10, 'must not remigrate from mutated display');
    assert.equal(projectSellable(state)[5], 8);
  });

  it('appendMovements is idempotent by movement_id', () => {
    let state = createEmptyLedger('v', 't');
    state = { ...state, snapshot: { '1': { sellable: 5 } } };
    const sale = buildSaleMovements(
      { operation_id: OP, created_at: 't', movement_ids: [M1] },
      [{ product_id: 1, qty: 1 }],
    );
    state = appendMovements(state, sale);
    state = appendMovements(state, sale);
    assert.equal(state.movements.length, 1);
    assert.equal(projectSellable(state)[1], 4);
  });

  it('E: recordInventoryMovements persists then projects (happy path)', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 42: 10 }, 'seed', '2026-08-16T00:00:00.000Z'),
    );
    const sale = buildSaleLedgerMovements({
      operationId: OP,
      lines: [{ product_id: 42, qty: 3 }],
      createdAt: '2026-08-16T10:00:00.000Z',
    });
    await recordInventoryMovements(sale, ports);
    assert.equal(ports._state?.movements.length, 1);
    assert.equal(ports._sellable[42], 7);
  });

  it('D: write failure commits neither queue nor ledger', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 42: 10 }, 'seed', '2026-08-16T00:00:00.000Z'),
    );
    ports._queue = [{ id: 'existing' }];
    ports._failNextWrite = true;
    const sale = buildSaleLedgerMovements({
      operationId: OP,
      lines: [{ product_id: 42, qty: 3 }],
    });
    await assert.rejects(
      () => commitSyncQueueAndLedger([{ id: 'new-sale' }], sale, ports),
      /disk full/,
    );
    assert.equal(ports._state?.movements.length, 0);
    assert.deepEqual(ports._queue, [{ id: 'existing' }]);
    assert.deepEqual(ports._sellable, {});
  });

  it('E2: queue + ledger success commits both', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 42: 10 }, 'seed', '2026-08-16T00:00:00.000Z'),
    );
    const sale = buildSaleLedgerMovements({
      operationId: OP,
      lines: [{ product_id: 42, qty: 1 }],
    });
    await commitSyncQueueAndLedger([{ id: OP, type: 'sale_order' }], sale, ports);
    assert.equal(ports._state?.movements.length, 1);
    assert.equal((ports._queue as { id: string }[])[0]?.id, OP);
    assert.equal(ports._sellable[42], 9);
  });

  it('C: simultaneous ledger writes do not lose updates', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 1: 10 }, 'seed', '2026-08-16T00:00:00.000Z'),
    );
    ports._writeDelayMs = 20;
    const saleA = buildSaleLedgerMovements({
      operationId: OP,
      lines: [{ product_id: 1, qty: 2 }],
      createdAt: '2026-08-16T10:00:00.000Z',
    });
    const saleB = buildSaleLedgerMovements({
      operationId: OP_B,
      lines: [{ product_id: 1, qty: 3 }],
      createdAt: '2026-08-16T10:00:01.000Z',
    });
    await Promise.all([
      recordInventoryMovements(saleA, ports),
      recordInventoryMovements(saleB, ports),
    ]);
    assert.equal(ports._state?.movements.length, 2);
    assert.equal(ports._sellable[1], 5);
  });

  it('F: restart hydrate keeps projection', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 3: 10 }, 'seed', '2026-08-16T00:00:00.000Z'),
    );
    await applySaleStockViaLedger({
      operationId: OP,
      lines: [{ product_id: 3, qty: 4 }],
      ports,
    });
    ports._sellable = {};
    const { state } = await loadOrMigrateLedger(ports);
    ports.applySellableProjection(projectSellable(state));
    assert.equal(ports._sellable[3], 6);
  });

  it('H: retry reversal does not double-compensate', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 8: 10 }, 'seed', '2026-08-16T00:00:00.000Z'),
    );
    const sale = buildSaleLedgerMovements({
      operationId: OP,
      lines: [{ product_id: 8, qty: 2 }],
    });
    await recordInventoryMovements(sale, ports);
    const reversals = buildReversalMovements(sale, {
      operation_id: OP,
      created_at: '2026-08-16T12:00:00.000Z',
    });
    assert.equal(reversals[0].movement_id, stableReversalMovementId(sale[0].movement_id));
    await recordInventoryMovements(reversals, ports);
    await recordInventoryMovements(reversals, ports);
    assert.equal(ports._state?.movements.length, 2);
    assert.equal(ports._sellable[8], 10);
  });

  it('I: ledger failure does not invoke counter-mutation fallback path', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/stores/useSyncStore.ts'),
      'utf8',
    );
    const start = src.indexOf('if (item.payload?._ledgerApplied === true)');
    const end = src.indexOf('const updateLocalStock = useProductStore.getState().updateLocalStock', start);
    assert.ok(start >= 0 && end > start);
    const ledgerBranch = src.slice(start, end);
    assert.doesNotMatch(ledgerBranch, /\bupdateLocalStock\s*\(/);
    assert.match(ledgerBranch, /_ledgerReviewRequired/);
  });

  it('does not claim ledger rollback without an operation_id', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/stores/useSyncStore.ts'),
      'utf8',
    );
    const start = src.indexOf("if (!operationId) {");
    const end = src.indexOf('void (async () => {', start);
    assert.ok(start >= 0 && end > start);
    const missingOperationBranch = src.slice(start, end);
    assert.match(missingOperationBranch, /_ledgerReviewRequired/);
    assert.match(missingOperationBranch, /_ledgerRollbackEvidencePending/);
    assert.doesNotMatch(missingOperationBranch, /markLocalStockRolledBack/);
  });

  it('inventory-ledger is a sensitive encrypted record', () => {
    assert.throws(() => assertEncryptedRecord('inventory-ledger', 'plaintext'));
    assert.doesNotThrow(() => assertEncryptedRecord('inventory-ledger', 'encrypted'));
    assert.throws(() => assertEncryptedRecord('sync:queue', 'plaintext'));
  });
});

describe('encrypted envelope multi-record RMW', () => {
  it('updateRecords writes queue+ledger in one put', async () => {
    const records = new Map<string, string>();
    const writes: string[] = [];
    const store = createEncryptedSessionStore({
      async get(key) {
        return records.get(key) ?? null;
      },
      async put(key, value) {
        writes.push(key);
        records.set(key, value);
      },
      async remove(key) {
        records.delete(key);
      },
    });
    const session = { companyId: 1, employeeId: 2, sessionId: 's' };
    await store.updateRecords(session, (api) => {
      api.setRecord('sync:queue', [{ id: 'op1' }]);
      api.setRecord('inventory-ledger', { version: 1, movements: [] });
    });
    assert.equal(writes.length, 1);
    assert.deepEqual(await store.load(session, 'sync:queue'), [{ id: 'op1' }]);
    assert.deepEqual(await store.load(session, 'inventory-ledger'), { version: 1, movements: [] });
  });
});

describe('exchange semantics', () => {
  it('damaged return never increases sellable', () => {
    const movements = buildExchangeMovements(
      { operation_id: OP, created_at: 't', movement_ids: [M1, M2] },
      [{ product_id: 8, qty: 1 }],
      [],
      [{ product_id: 8, qty: 1 }],
    );
    const projection = projectInventory({
      initialSnapshot: { '8': { sellable: 5 } },
      movements,
    });
    assert.equal(projection['8'].sellable, 4);
    assert.equal(projection['8'].damaged, 1);
  });

  it('good return increases return_good only', () => {
    const movements = buildExchangeMovements(
      { operation_id: OP, created_at: 't', movement_ids: [M1, M2] },
      [{ product_id: 8, qty: 1 }],
      [{ product_id: 8, qty: 1 }],
      [],
    );
    const projection = projectInventory({
      initialSnapshot: { '8': { sellable: 5 } },
      movements,
    });
    assert.equal(projection['8'].sellable, 4);
    assert.equal(projection['8'].return_good, 1);
    assert.equal(projection['8'].damaged, 0);
  });
});
