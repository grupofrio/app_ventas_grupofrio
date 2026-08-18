/**
 * Build canonical inventory movements for commercial operations.
 * Pure / RN-free. Caller supplies UUID v4 ids (never mint on retry).
 */

import {
  assertUuid,
  assertUuidV4,
  type InventoryMovement,
  type InventorySyncStatus,
  type MovementType,
} from './types.ts';
import { stableReversalMovementId } from './stableIds.ts';

export interface MovementLine {
  product_id: number;
  qty: number;
  uom?: string | null;
}

export interface BuildMovementContext {
  operation_id: string;
  created_at: string;
  stop_id?: number | null;
  partner_id?: number | null;
  plan_id?: number | null;
  employee_id?: number | null;
  sync_status?: InventorySyncStatus;
  /** One UUID v4 per line, stable across retries for that line slot. */
  movement_ids: string[];
}

function requirePositiveLines(lines: MovementLine[]): MovementLine[] {
  return (Array.isArray(lines) ? lines : []).filter(
    (line) =>
      line &&
      typeof line.product_id === 'number' &&
      Number.isFinite(line.product_id) &&
      typeof line.qty === 'number' &&
      Number.isFinite(line.qty) &&
      line.qty > 0,
  );
}

function baseMovement(
  ctx: BuildMovementContext,
  index: number,
  line: MovementLine,
  movement_type: MovementType,
  bucket_from: InventoryMovement['bucket_from'],
  bucket_to: InventoryMovement['bucket_to'],
  metadata?: Record<string, unknown>,
): InventoryMovement {
  const movement_id = ctx.movement_ids[index];
  if (!movement_id) {
    throw new Error(`missing movement_id for line index ${index}`);
  }
  assertUuidV4(ctx.operation_id, 'operation_id');
  assertUuid(movement_id, 'movement_id');
  return {
    movement_id,
    operation_id: ctx.operation_id,
    movement_type,
    product_id: line.product_id,
    quantity: line.qty,
    uom: line.uom ?? null,
    bucket_from,
    bucket_to,
    stop_id: ctx.stop_id ?? null,
    partner_id: ctx.partner_id ?? null,
    plan_id: ctx.plan_id ?? null,
    employee_id: ctx.employee_id ?? null,
    created_at: ctx.created_at,
    sync_status: ctx.sync_status ?? 'pending',
    server_reference: null,
    metadata: metadata ?? {},
  };
}

export function buildSaleMovements(ctx: BuildMovementContext, lines: MovementLine[]): InventoryMovement[] {
  return requirePositiveLines(lines).map((line, index) =>
    baseMovement(ctx, index, line, 'sale', 'sellable', null),
  );
}

export function buildGiftMovements(ctx: BuildMovementContext, lines: MovementLine[]): InventoryMovement[] {
  return requirePositiveLines(lines).map((line, index) =>
    baseMovement(ctx, index, line, 'gift', 'sellable', null),
  );
}

/** Create / visit-restock: van sellable → customer consigned. */
export function buildConsignmentOutMovements(
  ctx: BuildMovementContext,
  lines: MovementLine[],
): InventoryMovement[] {
  return requirePositiveLines(lines).map((line, index) =>
    baseMovement(ctx, index, line, 'consignment_out', 'sellable', 'consigned'),
  );
}

/**
 * Visit sold qty: customer consigned consumed (charged). Paired with
 * buildConsignmentOutMovements(restock) so consigned net is unchanged and
 * van sellable decreases by restock.
 */
export function buildConsignmentSoldMovements(
  ctx: BuildMovementContext,
  lines: MovementLine[],
): InventoryMovement[] {
  return requirePositiveLines(lines).map((line, index) =>
    baseMovement(ctx, index, line, 'consignment_sold', 'consigned', null),
  );
}

/** Close return: remaining physical consigned → van sellable. */
export function buildConsignmentReturnMovements(
  ctx: BuildMovementContext,
  lines: MovementLine[],
): InventoryMovement[] {
  return requirePositiveLines(lines).map((line, index) =>
    baseMovement(ctx, index, line, 'consignment_return', 'consigned', 'sellable'),
  );
}

export function buildExchangeMovements(
  ctx: BuildMovementContext,
  delivery: MovementLine[],
  returnGood: MovementLine[] = [],
  returnDamaged: MovementLine[] = [],
): InventoryMovement[] {
  const movements: InventoryMovement[] = [];
  let index = 0;
  for (const line of requirePositiveLines(delivery)) {
    movements.push(baseMovement(ctx, index, line, 'exchange_delivery', 'sellable', null));
    index += 1;
  }
  for (const line of requirePositiveLines(returnGood)) {
    movements.push(baseMovement(ctx, index, line, 'exchange_return_good', null, 'return_good'));
    index += 1;
  }
  for (const line of requirePositiveLines(returnDamaged)) {
    movements.push(baseMovement(ctx, index, line, 'exchange_return_damaged', null, 'damaged'));
    index += 1;
  }
  return movements;
}

export function buildReversalMovements(
  originals: InventoryMovement[],
  ctx: {
    operation_id: string;
    created_at: string;
    sync_status?: InventorySyncStatus;
    /** When omitted, each reversal id is derived stably from the original movement_id. */
    movement_ids?: string[];
  },
): InventoryMovement[] {
  assertUuidV4(ctx.operation_id, 'operation_id');
  return originals.map((original, index) => {
    const movement_id = ctx.movement_ids?.[index] ?? stableReversalMovementId(original.movement_id);
    assertUuid(movement_id, 'movement_id');
    return {
      movement_id,
      operation_id: ctx.operation_id,
      movement_type: 'reversal',
      product_id: original.product_id,
      quantity: original.quantity,
      uom: original.uom ?? null,
      // Swap sides to compensate.
      bucket_from: original.bucket_to,
      bucket_to: original.bucket_from,
      stop_id: original.stop_id ?? null,
      partner_id: original.partner_id ?? null,
      plan_id: original.plan_id ?? null,
      employee_id: original.employee_id ?? null,
      created_at: ctx.created_at,
      sync_status: ctx.sync_status ?? 'pending',
      server_reference: null,
      metadata: {
        reverses_movement_id: original.movement_id,
        reverses_operation_id: original.operation_id,
        original_type: original.movement_type,
      },
    };
  });
}

export function buildInitialLoadMovements(
  ctx: BuildMovementContext,
  lines: MovementLine[],
): InventoryMovement[] {
  return requirePositiveLines(lines).map((line, index) =>
    baseMovement(ctx, index, line, 'initial_load', null, 'sellable'),
  );
}
