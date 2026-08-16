/**
 * Screen/service adapters: build movements + record via ledger (no updateLocalStock).
 */

import {
  buildExchangeMovements,
  buildGiftMovements,
  buildSaleMovements,
  type MovementLine,
} from '../domain/inventory/buildMovements.ts';
import { createUuidV4 } from '../utils/clientEvent.ts';
import { recordInventoryMovements, type InventoryLedgerPorts } from './inventoryLedger.ts';

function movementIdsFor(count: number): string[] {
  return Array.from({ length: count }, () => createUuidV4());
}

export async function applySaleStockViaLedger(args: {
  operationId: string;
  lines: MovementLine[];
  stopId?: number | null;
  partnerId?: number | null;
  planId?: number | null;
  employeeId?: number | null;
  ports?: InventoryLedgerPorts;
}): Promise<void> {
  const lines = args.lines;
  const movements = buildSaleMovements(
    {
      operation_id: args.operationId,
      created_at: new Date().toISOString(),
      stop_id: args.stopId,
      partner_id: args.partnerId,
      plan_id: args.planId,
      employee_id: args.employeeId,
      movement_ids: movementIdsFor(lines.length),
    },
    lines,
  );
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
  const lines = args.lines;
  const movements = buildGiftMovements(
    {
      operation_id: args.operationId,
      created_at: new Date().toISOString(),
      stop_id: args.stopId,
      partner_id: args.partnerId,
      movement_ids: movementIdsFor(lines.length),
    },
    lines,
  );
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
  const delivery = args.delivery;
  const returnGood = args.returnGood ?? [];
  const returnDamaged = args.returnDamaged ?? [];
  const count = delivery.length + returnGood.length + returnDamaged.length;
  const movements = buildExchangeMovements(
    {
      operation_id: args.operationId,
      created_at: new Date().toISOString(),
      stop_id: args.stopId,
      partner_id: args.partnerId,
      movement_ids: movementIdsFor(count),
    },
    delivery,
    returnGood,
    returnDamaged,
  );
  if (movements.length === 0) return;
  await recordInventoryMovements(movements, args.ports);
}
