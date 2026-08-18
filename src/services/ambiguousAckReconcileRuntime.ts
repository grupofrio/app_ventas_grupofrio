/**
 * Production binding for INV-1B ambiguous ack reconcile.
 *
 * Ordering:
 *   backend authority → ACK intents → durable latest-queue mutation → memory publish
 * Caller then takes a fresh truck_stock (snapshotAtMs fence) and rebases the ledger.
 */

import {
  reconcileAmbiguousLedgerOperations,
  runReconcileAmbiguousLedgerFlight,
  type AmbiguousAckStatus,
  type AmbiguousQueueItem,
  type ReconcileAmbiguousResult,
  type ServerAckIntent,
} from './ambiguousAckReconcile.ts';
import {
  closeConsignment,
  createConsignment,
  visitConsignment,
} from './consignment.ts';
import { checkSaleDuplicate, createExchange } from './gfLogistics.ts';
import { createGift } from './gfSalesOps.ts';
import { readSaleSubmissionErrorMetadata } from './saleSubmissionOutcome.ts';
import { classifySaleSubmissionError } from './saleSubmissionOutcome.ts';
import type { ConsignmentCountLine, CreateConsignmentLine } from '../types/consignment.ts';

function classifySaleCheckError(error: unknown): AmbiguousAckStatus {
  const meta = readSaleSubmissionErrorMetadata(error);
  if (meta.httpStatus === 401 || meta.httpStatus === 403) return 'ambiguous';
  if (meta.httpStatus === 404) return 'not_found';
  if (typeof meta.httpStatus === 'number' && meta.httpStatus >= 500) return 'ambiguous';
  if (meta.code === 'timeout' || meta.name === 'AbortError') return 'ambiguous';
  const kind = classifySaleSubmissionError(error).kind;
  if (kind === 'definitive_rejection') return 'definitive_failure';
  return 'ambiguous';
}

function classifyGiftError(error: unknown): AmbiguousAckStatus {
  const message = error instanceof Error ? error.message : String(error);
  // Known definitive validation codes from gift create.
  if (/UNAUTHORIZED|FORBIDDEN|VALIDATION_ERROR|missing_/i.test(message)) {
    return 'definitive_failure';
  }
  return 'ambiguous';
}

function classifyExchangeError(error: unknown): AmbiguousAckStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNAUTHORIZED|FORBIDDEN|VALIDATION_ERROR|SERVER_MISCONFIG|missing_/i.test(message)) {
    return 'definitive_failure';
  }
  return 'ambiguous';
}

function classifyConsignmentError(error: unknown): AmbiguousAckStatus {
  const meta = readSaleSubmissionErrorMetadata(error);
  if (meta.httpStatus === 401 || meta.httpStatus === 403) return 'ambiguous';
  if (meta.httpStatus === 404) return 'not_found';
  if (meta.httpStatus === 409) return 'committed'; // conflict / already bound → treat as present
  if (typeof meta.httpStatus === 'number' && meta.httpStatus >= 500) return 'ambiguous';
  if (meta.code === 'timeout' || meta.name === 'AbortError') return 'ambiguous';
  const message = error instanceof Error ? error.message : String(error);
  if (/idempotency_conflict|VALIDATION_ERROR|access_denied|no tienes acceso/i.test(message)) {
    return 'definitive_failure';
  }
  return 'ambiguous';
}

function asCreateLines(raw: unknown): CreateConsignmentLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      product_id: Number(row.product_id),
      target_qty: Number(row.target_qty),
    }))
    .filter((row) => row.product_id > 0 && row.target_qty > 0);
}

function asCountLines(raw: unknown): ConsignmentCountLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      product_id: Number(row.product_id),
      physical_qty: Number(row.physical_qty),
    }))
    .filter((row) => row.product_id > 0 && Number.isFinite(row.physical_qty));
}

async function replayConsignment(item: AmbiguousQueueItem): Promise<void> {
  const operationId =
    (typeof item.payload.operation_id === 'string' && item.payload.operation_id)
    || (typeof item.payload._operationId === 'string' && item.payload._operationId)
    || item.id;
  if (item.type === 'consignment_create') {
    const partnerId = Number(item.payload.partner_id);
    if (!(partnerId > 0)) throw new Error('missing_partner_id');
    await createConsignment({
      partnerId,
      operationId,
      lines: asCreateLines(item.payload.lines),
      notes: typeof item.payload.notes === 'string' ? item.payload.notes : undefined,
    });
    return;
  }
  if (item.type === 'consignment_visit' || item.type === 'consignment_close') {
    const consignmentId = Number(item.payload.consignment_id);
    if (!(consignmentId > 0)) throw new Error('missing_consignment_id');
    const paymentMethod = item.payload.payment_method === 'cash' ? 'cash' : 'cash';
    const input = {
      consignmentId,
      operationId,
      paymentMethod: paymentMethod as 'cash',
      counts: asCountLines(item.payload.counts),
    };
    if (item.type === 'consignment_visit') await visitConsignment(input);
    else await closeConsignment(input);
  }
}

export async function reconcileAmbiguousLedgerOpsAgainstStore(args: {
  queue: AmbiguousQueueItem[];
  /**
   * Serialized durable RMW: mutate matching ops on the *current* queue,
   * persist, then publish memory. Must reject if durable write fails
   * (no memory ACK publish on failure).
   */
  applyAcknowledgementsDurably: (intents: ServerAckIntent[]) => Promise<void>;
  nowMs?: () => number;
}): Promise<ReconcileAmbiguousResult> {
  return runReconcileAmbiguousLedgerFlight(async () => {
    const result = await reconcileAmbiguousLedgerOperations(args.queue, {
      nowMs: args.nowMs ?? (() => Date.now()),
      checkSaleDuplicate: async (payload) => {
        const checked = await checkSaleDuplicate(payload);
        return { duplicate: checked.duplicate };
      },
      replayGift: async (payload) => {
        await createGift(payload);
      },
      replayExchange: async (payload) => {
        await createExchange(payload);
      },
      classifyGiftError,
      classifyExchangeError,
      classifySaleCheckError,
      replayConsignment,
      classifyConsignmentError,
    });
    if (result.intents.length > 0) {
      await args.applyAcknowledgementsDurably(result.intents);
    }
    return result;
  });
}
