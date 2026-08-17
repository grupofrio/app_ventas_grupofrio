/**
 * POST-R1C — consignación offline: ledger movements + sync payload builders.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildConsignmentOutMovements,
  buildConsignmentReturnMovements,
  buildConsignmentSoldMovements,
} from '../src/domain/inventory/buildMovements.ts';
import { projectInventory } from '../src/domain/inventory/projectInventory.ts';
import {
  consignmentOutSlot,
  consignmentReturnSlot,
  consignmentSoldSlot,
  stableMovementId,
} from '../src/domain/inventory/stableIds.ts';
import {
  buildConsignmentCloseLedgerMovements,
  buildConsignmentCreateLedgerMovements,
  buildConsignmentVisitLedgerMovements,
} from '../src/services/inventoryLedgerAdapters.ts';
import {
  buildConsignmentCreateSyncPayload,
  buildConsignmentLedgerForKind,
  countLinesToVisitSold,
  createLinesToMovementLines,
} from '../src/services/consignmentOffline.ts';

const OP = '00000000-0000-4000-8000-0000000000c1';

describe('consignment ledger semantics', () => {
  it('create: sellable → consigned (not merma / not cash)', () => {
    const lines = [{ product_id: 10, qty: 5 }];
    const movements = buildConsignmentOutMovements(
      {
        operation_id: OP,
        created_at: '2026-08-17T12:00:00.000Z',
        movement_ids: [stableMovementId(OP, consignmentOutSlot(10, 0))],
      },
      lines,
    );
    const projection = projectInventory({
      initialSnapshot: { '10': { sellable: 20, consigned: 0 } },
      movements,
    });
    assert.equal(projection['10'].sellable, 15);
    assert.equal(projection['10'].consigned, 5);
    assert.equal(projection['10'].damaged, 0);
  });

  it('visit: restock + sold → sellable −N, consigned unchanged', () => {
    const sold = [{ product_id: 10, qty: 3 }];
    const restock = buildConsignmentOutMovements(
      {
        operation_id: OP,
        created_at: '2026-08-17T12:01:00.000Z',
        movement_ids: [stableMovementId(OP, consignmentOutSlot(10, 0))],
      },
      sold,
    );
    const consumed = buildConsignmentSoldMovements(
      {
        operation_id: OP,
        created_at: '2026-08-17T12:01:00.000Z',
        movement_ids: [stableMovementId(OP, consignmentSoldSlot(10, 0))],
      },
      sold,
    );
    const projection = projectInventory({
      initialSnapshot: { '10': { sellable: 15, consigned: 5 } },
      movements: [...restock, ...consumed],
    });
    assert.equal(projection['10'].sellable, 12);
    assert.equal(projection['10'].consigned, 5);
  });

  it('close: return physical + sold consume → consigned cleared, sellable +return', () => {
    const returned = buildConsignmentReturnMovements(
      {
        operation_id: OP,
        created_at: '2026-08-17T12:02:00.000Z',
        movement_ids: [stableMovementId(OP, consignmentReturnSlot(10, 0))],
      },
      [{ product_id: 10, qty: 2 }],
    );
    const sold = buildConsignmentSoldMovements(
      {
        operation_id: OP,
        created_at: '2026-08-17T12:02:00.000Z',
        movement_ids: [stableMovementId(OP, consignmentSoldSlot(10, 0))],
      },
      [{ product_id: 10, qty: 3 }],
    );
    const projection = projectInventory({
      initialSnapshot: { '10': { sellable: 12, consigned: 5 } },
      movements: [...returned, ...sold],
    });
    assert.equal(projection['10'].consigned, 0);
    assert.equal(projection['10'].sellable, 14);
  });

  it('stable movement ids are deterministic for retries', () => {
    const a = buildConsignmentCreateLedgerMovements({
      operationId: OP,
      lines: [{ product_id: 7, qty: 2 }, { product_id: 3, qty: 1 }],
    });
    const b = buildConsignmentCreateLedgerMovements({
      operationId: OP,
      lines: [{ product_id: 3, qty: 1 }, { product_id: 7, qty: 2 }],
    });
    assert.deepEqual(
      a.map((m) => m.movement_id).sort(),
      b.map((m) => m.movement_id).sort(),
    );
  });

  it('visit/close helpers match count math', () => {
    const counts = [
      { product_id: 1, target_qty: 10, physical_qty: 7, price_unit: 5 },
      { product_id: 2, target_qty: 4, physical_qty: 4, price_unit: 1 },
    ];
    assert.deepEqual(countLinesToVisitSold(counts), [{ product_id: 1, qty: 3 }]);
    const visit = buildConsignmentVisitLedgerMovements({ operationId: OP, soldLines: countLinesToVisitSold(counts) });
    assert.equal(visit.length, 2);
    const close = buildConsignmentCloseLedgerMovements({
      operationId: OP,
      returnLines: [{ product_id: 1, qty: 7 }, { product_id: 2, qty: 4 }],
      soldLines: [{ product_id: 1, qty: 3 }],
    });
    assert.ok(close.some((m) => m.movement_type === 'consignment_return'));
    assert.ok(close.some((m) => m.movement_type === 'consignment_sold'));
  });

  it('sync create payload keeps operation_id and apply_inventory', () => {
    const payload = buildConsignmentCreateSyncPayload({
      partnerId: 99,
      operationId: OP,
      lines: [{ product_id: 1, target_qty: 2, price_unit: 10 }],
    });
    assert.equal(payload.operation_id, OP);
    assert.equal(payload.apply_inventory, true);
    assert.equal(payload._ledgerApplied, true);
    assert.deepEqual(createLinesToMovementLines(payload.lines as never), [
      { product_id: 1, qty: 2 },
    ]);
  });

  it('buildConsignmentLedgerForKind create produces consignment_out only', () => {
    const movements = buildConsignmentLedgerForKind({
      kind: 'create',
      operationId: OP,
      createLines: [{ product_id: 8, target_qty: 4, price_unit: 1 }],
    });
    assert.equal(movements.length, 1);
    assert.equal(movements[0].movement_type, 'consignment_out');
    assert.equal(movements[0].bucket_from, 'sellable');
    assert.equal(movements[0].bucket_to, 'consigned');
  });
});
