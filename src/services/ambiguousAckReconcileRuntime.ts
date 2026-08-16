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
import { checkSaleDuplicate } from './gfLogistics.ts';
import { createGift } from './gfSalesOps.ts';
import { readSaleSubmissionErrorMetadata } from './saleSubmissionOutcome.ts';
import { classifySaleSubmissionError } from './saleSubmissionOutcome.ts';

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
      classifyGiftError,
      classifySaleCheckError,
    });
    if (result.intents.length > 0) {
      await args.applyAcknowledgementsDurably(result.intents);
    }
    return result;
  });
}
