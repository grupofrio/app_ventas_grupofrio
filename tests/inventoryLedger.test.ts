/**
 * Inventory ledger domain + persistence tests (POST-R1A).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildExchangeMovements, buildGiftMovements, buildReversalMovements, buildSaleMovements } from '../src/domain/inventory/buildMovements.ts';
import { appendMovements, createEmptyLedger, migrateLegacySellableSnapshot, projectSellable } from '../src/domain/inventory/ledgerState.ts';
import { projectInventory } from '../src/domain/inventory/projectInventory.ts';
import {
  createMemoryLedgerPorts,
  recordInventoryMovements,
} from '../src/services/inventoryLedgerLogic.ts';
import { assertEncryptedRecord } from '../src/services/encryptedStoreLogic.ts';

const OP = '00000000-0000-4000-8000-0000000000a1';
const M1 = '00000000-0000-4000-8000-0000000000b1';
const M2 = '00000000-0000-4000-8000-0000000000b2';
const M3 = '00000000-0000-4000-8000-0000000000b3';
const M4 = '00000000-0000-4000-8000-0000000000b4';
const R1 = '00000000-0000-4000-8000-0000000000c1';
const R2 = '00000000-0000-4000-8000-0000000000c2';

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
    assert.equal(projection['10'].physical_van, 7);
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
      movement_ids: [R1],
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

describe('ledger state + persistence barrier', () => {
  it('migrateLegacySellableSnapshot folds displays into baseline', () => {
    const state = migrateLegacySellableSnapshot({ 3: 4, 9: 1 }, 'v1', '2026-08-16T00:00:00.000Z');
    assert.equal(state.movements.length, 0);
    assert.equal(state.snapshot['3']?.sellable, 4);
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

  it('recordInventoryMovements persists then projects (atomic happy path)', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 42: 10 }, 'seed', '2026-08-16T00:00:00.000Z'),
    );
    const sale = buildSaleMovements(
      { operation_id: OP, created_at: '2026-08-16T10:00:00.000Z', movement_ids: [M1] },
      [{ product_id: 42, qty: 3 }],
    );
    await recordInventoryMovements(sale, ports);
    assert.equal(ports._state?.movements.length, 1);
    assert.equal((ports as { _sellable: Record<number, number> })._sellable[42], 7);
  });

  it('recordInventoryMovements does not project when save fails', async () => {
    const ports = createMemoryLedgerPorts(
      migrateLegacySellableSnapshot({ 42: 10 }, 'seed', '2026-08-16T00:00:00.000Z'),
    );
    ports.save = async () => {
      throw new Error('disk full');
    };
    const sale = buildSaleMovements(
      { operation_id: OP, created_at: '2026-08-16T10:00:00.000Z', movement_ids: [M1] },
      [{ product_id: 42, qty: 3 }],
    );
    await assert.rejects(() => recordInventoryMovements(sale, ports), /disk full/);
    assert.deepEqual((ports as { _sellable: Record<number, number> })._sellable, {});
  });

  it('inventory-ledger is a sensitive encrypted record', () => {
    assert.throws(() => assertEncryptedRecord('inventory-ledger', 'plaintext'));
    assert.doesNotThrow(() => assertEncryptedRecord('inventory-ledger', 'encrypted'));
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
