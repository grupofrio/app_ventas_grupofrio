/**
 * Screen/service adapters: stable movement ids + ledger apply (no updateLocalStock).
 */

import {
  buildExchangeMovements,
  buildGiftMovements,
  buildSaleMovements,
  type MovementLine,
} from '../domain/inventory/buildMovements.ts';
import {
  exchangeDeliverySlot,
  exchangeReturnDamagedSlot,
  exchangeReturnGoodSlot,
  giftMovementSlot,
  saleMovementSlot,
  stableMovementId,
} from '../domain/inventory/stableIds.ts';
import {
  commitSyncQueueAndLedger,
  recordInventoryMovements,
  type InventoryLedgerPorts,
} from './inventoryLedger.ts';

/**
 * INV-6: Canonicalize line order before assigning semantic slots so retries
 * with reordered lines yield the same movement_id set. Identity is
 * (kind, product_id, occurrence) after sort by product_id then qty — not
 * created_at and not raw array index of the unsorted payload.
 */
export function canonicalizeMovementLines(lines: MovementLine[]): MovementLine[] {
  return [...lines].sort((a, b) => {
    if (a.product_id !== b.product_id) return a.product_id - b.product_id;
    return a.qty - b.qty;
  });
}

function saleMovementIds(operationId: string, lines: MovementLine[]): string[] {
  return lines.map((line, index) =>
    stableMovementId(operationId, saleMovementSlot(line.product_id, index)),
  );
}

function giftMovementIds(operationId: string, lines: MovementLine[]): string[] {
  return lines.map((line, index) =>
    stableMovementId(operationId, giftMovementSlot(line.product_id, index)),
  );
}

function exchangeMovementIds(
  operationId: string,
  delivery: MovementLine[],
  returnGood: MovementLine[],
  returnDamaged: MovementLine[],
): string[] {
  const ids: string[] = [];
  delivery.forEach((line, index) => {
    ids.push(stableMovementId(operationId, exchangeDeliverySlot(line.product_id, index)));
  });
  returnGood.forEach((line, index) => {
    ids.push(stableMovementId(operationId, exchangeReturnGoodSlot(line.product_id, index)));
  });
  returnDamaged.forEach((line, index) => {
    ids.push(stableMovementId(operationId, exchangeReturnDamagedSlot(line.product_id, index)));
  });
  return ids;
}

export function buildSaleLedgerMovements(args: {
  operationId: string;
  lines: MovementLine[];
  stopId?: number | null;
  partnerId?: number | null;
  planId?: number | null;
  employeeId?: number | null;
  createdAt?: string;
}) {
  const lines = canonicalizeMovementLines(args.lines);
  return buildSaleMovements(
    {
      operation_id: args.operationId,
      created_at: args.createdAt ?? new Date().toISOString(),
      stop_id: args.stopId,
      partner_id: args.partnerId,
      plan_id: args.planId,
      employee_id: args.employeeId,
      movement_ids: saleMovementIds(args.operationId, lines),
    },
    lines,
  );
}

export function buildGiftLedgerMovements(args: {
  operationId: string;
  lines: MovementLine[];
  stopId?: number | null;
  partnerId?: number | null;
  createdAt?: string;
}) {
  const lines = canonicalizeMovementLines(args.lines);
  return buildGiftMovements(
    {
      operation_id: args.operationId,
      created_at: args.createdAt ?? new Date().toISOString(),
      stop_id: args.stopId,
      partner_id: args.partnerId,
      movement_ids: giftMovementIds(args.operationId, lines),
    },
    lines,
  );
}

export function buildExchangeLedgerMovements(args: {
  operationId: string;
  delivery: MovementLine[];
  returnGood?: MovementLine[];
  returnDamaged?: MovementLine[];
  stopId?: number | null;
  partnerId?: number | null;
  createdAt?: string;
}) {
  const delivery = canonicalizeMovementLines(args.delivery);
  const returnGood = canonicalizeMovementLines(args.returnGood ?? []);
  const returnDamaged = canonicalizeMovementLines(args.returnDamaged ?? []);
  return buildExchangeMovements(
    {
      operation_id: args.operationId,
      created_at: args.createdAt ?? new Date().toISOString(),
      stop_id: args.stopId,
      partner_id: args.partnerId,
      movement_ids: exchangeMovementIds(args.operationId, delivery, returnGood, returnDamaged),
    },
    delivery,
    returnGood,
    returnDamaged,
  );
}

/** Ledger-only path (online confirmed ops with no new queue row). */
export async function applySaleStockViaLedger(args: {
  operationId: string;
  lines: MovementLine[];
  stopId?: number | null;
  partnerId?: number | null;
  planId?: number | null;
  employeeId?: number | null;
  ports?: InventoryLedgerPorts;
}): Promise<void> {
  const movements = buildSaleLedgerMovements(args);
  if (movements.length === 0) return;
  await recordInventoryMovements(movements, args.ports);
}

export async function applyGiftStockViaLedger(args: {
  operationId: string;
  lines: MovementLine[];
  stopId?: number | null;
  partnerId?: number | null;
  ports?: InventoryLedgerPorts;
}): Promise<void> {
  const movements = buildGiftLedgerMovements(args);
  if (movements.length === 0) return;
  await recordInventoryMovements(movements, args.ports);
}

export async function applyExchangeStockViaLedger(args: {
  operationId: string;
  delivery: MovementLine[];
  returnGood?: MovementLine[];
  returnDamaged?: MovementLine[];
  stopId?: number | null;
  partnerId?: number | null;
  ports?: InventoryLedgerPorts;
}): Promise<void> {
  const movements = buildExchangeLedgerMovements(args);
  if (movements.length === 0) return;
  await recordInventoryMovements(movements, args.ports);
}

/**
 * Durable barrier: current in-memory sync queue snapshot + ledger movements
 * in one encrypted envelope write. Used after enqueue(..., { skipPersist: true }).
 */
export async function commitQueuedOperationWithLedger(args: {
  nextQueue: unknown[];
  movements: ReturnType<typeof buildSaleLedgerMovements>;
  ports?: InventoryLedgerPorts;
}): Promise<void> {
  if (args.movements.length === 0) {
    throw new Error('commitQueuedOperationWithLedger requires movements');
  }
  await commitSyncQueueAndLedger(args.nextQueue, args.movements, args.ports);
}
