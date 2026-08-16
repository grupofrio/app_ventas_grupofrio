import type { SyncItemType } from '../types/sync.ts';
import { classifySaleSubmissionError } from './saleSubmissionOutcome.ts';
import type { SyncQueueItem } from '../types/sync.ts';
import { isRetryableSyncErrorMessage } from '../utils/syncFailure.ts';

export const AUTOMATIC_SYNC_RETRY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const MANUAL_RECONCILIATION_REQUIRED_MESSAGE =
  'Operación expirada: requiere reconciliación manual antes de reenviarse.';

type RetryAgeItem = Pick<SyncQueueItem, 'created_at'>;

/**
 * The backend retains idempotency keys for 120 days, but the device must stop
 * automatic retries after 90. This leaves a 30-day reconciliation window and
 * prevents a stale offline mutation from being resent without an operator.
 */
export function requiresSyncReconciliation(
  item: RetryAgeItem,
  now: number = Date.now(),
): boolean {
  return now - item.created_at >= AUTOMATIC_SYNC_RETRY_MAX_AGE_MS;
}

/**
 * Keep the original queued operation intact for the reconciliation UI. A dead
 * item is durable queue state, is not an automatic processing candidate, and
 * has no wake timer scheduled for it.
 */
export function toManualReconciliationItem(item: SyncQueueItem): SyncQueueItem {
  return {
    ...item,
    status: 'dead',
    error_message: MANUAL_RECONCILIATION_REQUIRED_MESSAGE,
    next_retry_at: null,
  };
}

/**
 * Expire only live work. Completed work is intentionally ignored, while an
 * existing terminal record keeps its original diagnostic message.
 */
export function transitionAgedItemsToManualReconciliation(
  queue: SyncQueueItem[],
  now: number = Date.now(),
): SyncQueueItem[] {
  let changed = false;
  const transitioned = queue.map((item) => {
    if (
      item.status !== 'done'
      && item.status !== 'dead'
      && requiresSyncReconciliation(item, now)
    ) {
      changed = true;
      return toManualReconciliationItem(item);
    }
    return item;
  });
  return changed ? transitioned : queue;
}

export function shouldRetrySyncItemError(type: SyncItemType, error: unknown): boolean {
  if (type === 'sale_order') {
    return classifySaleSubmissionError(error).kind === 'ambiguous_result';
  }
  const message = error instanceof Error ? error.message : 'Sync error';
  return isRetryableSyncErrorMessage(message);
}
