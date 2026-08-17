/**
 * Consignment offline helpers — pure payload builders + ledger movement selection.
 * Network I/O stays in consignment.ts; queue/ledger wiring in the screen / sync store.
 */

import type { MovementLine } from '../domain/inventory/buildMovements';
import type { ConsignmentCountLine, CreateConsignmentLine } from '../types/consignment';
import {
  buildConsignmentCloseLedgerMovements,
  buildConsignmentCreateLedgerMovements,
  buildConsignmentVisitLedgerMovements,
} from './inventoryLedgerAdapters.ts';

export type ConsignmentSyncKind = 'create' | 'visit' | 'close';

export function consignmentSyncItemType(
  kind: ConsignmentSyncKind,
): 'consignment_create' | 'consignment_visit' | 'consignment_close' {
  if (kind === 'create') return 'consignment_create';
  if (kind === 'visit') return 'consignment_visit';
  return 'consignment_close';
}

export function buildConsignmentCreateSyncPayload(args: {
  partnerId: number;
  operationId: string;
  lines: CreateConsignmentLine[];
  notes?: string;
  stopId?: number | null;
}): Record<string, unknown> {
  return {
    partner_id: args.partnerId,
    operation_id: args.operationId,
    apply_inventory: true,
    lines: args.lines,
    ...(args.notes && args.notes.trim() ? { notes: args.notes.trim() } : {}),
    _operationId: args.operationId,
    _ledgerApplied: true,
    _stopId: args.stopId ?? null,
  };
}

export function buildConsignmentCountSyncPayload(args: {
  kind: 'visit' | 'close';
  consignmentId: number;
  operationId: string;
  paymentMethod: string;
  counts: ConsignmentCountLine[];
  stopId?: number | null;
  partnerId?: number | null;
}): Record<string, unknown> {
  return {
    consignment_id: args.consignmentId,
    operation_id: args.operationId,
    payment_method: args.paymentMethod,
    counts: args.counts,
    _operationId: args.operationId,
    _ledgerApplied: true,
    _stopId: args.stopId ?? null,
    _partnerId: args.partnerId ?? null,
    _consignmentKind: args.kind,
  };
}

export function createLinesToMovementLines(lines: CreateConsignmentLine[]): MovementLine[] {
  return lines.map((line) => ({
    product_id: line.product_id,
    qty: line.target_qty,
  }));
}

/** sold_qty = max(0, target − physical); return_qty = physical. */
export function countLinesToVisitSold(counts: ConsignmentCountLine[]): MovementLine[] {
  return counts
    .map((c) => ({
      product_id: c.product_id,
      qty: Math.max(0, Number(c.target_qty) - Number(c.physical_qty)),
    }))
    .filter((l) => l.qty > 0);
}

export function countLinesToCloseReturn(counts: ConsignmentCountLine[]): MovementLine[] {
  return counts
    .map((c) => ({
      product_id: c.product_id,
      qty: Math.max(0, Number(c.physical_qty)),
    }))
    .filter((l) => l.qty > 0);
}

export function countLinesToCloseSold(counts: ConsignmentCountLine[]): MovementLine[] {
  return countLinesToVisitSold(counts);
}

export function buildConsignmentLedgerForKind(args: {
  kind: ConsignmentSyncKind;
  operationId: string;
  createLines?: CreateConsignmentLine[];
  counts?: ConsignmentCountLine[];
  stopId?: number | null;
  partnerId?: number | null;
}) {
  if (args.kind === 'create') {
    return buildConsignmentCreateLedgerMovements({
      operationId: args.operationId,
      lines: createLinesToMovementLines(args.createLines ?? []),
      stopId: args.stopId,
      partnerId: args.partnerId,
    });
  }
  const counts = args.counts ?? [];
  if (args.kind === 'visit') {
    return buildConsignmentVisitLedgerMovements({
      operationId: args.operationId,
      soldLines: countLinesToVisitSold(counts),
      stopId: args.stopId,
      partnerId: args.partnerId,
    });
  }
  return buildConsignmentCloseLedgerMovements({
    operationId: args.operationId,
    returnLines: countLinesToCloseReturn(counts),
    soldLines: countLinesToCloseSold(counts),
    stopId: args.stopId,
    partnerId: args.partnerId,
  });
}
