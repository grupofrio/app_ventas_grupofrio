/**
 * Pure helper to "rearm" a failed sale_order item back to pending so the
 * sync processor will retry it. Extracted from the checkout retry handler
 * so it can be unit-tested without spinning up zustand or React Native.
 *
 * Why this is needed:
 *   useSyncStore exposes markError / markDead which are forward-only state
 *   transitions in the V2 state machine. To explicitly retry a failed item
 *   we have to write the queue directly (the public API doesn't expose a
 *   "rearm" action because most callers should rely on backoff). Pulling
 *   the transformation into a pure function keeps the side effect at the
 *   call site (zustand setState) and lets us test the rules:
 *
 *   - Only the matching {id, type:'sale_order'} item is touched.
 *   - retries → 0 so the next cycle isn't gated by MAX_RETRIES.
 *   - next_retry_at → null so backoff doesn't postpone the retry.
 *   - error_message → null so the UI banner clears immediately.
 *   - status → 'pending' so processQueue picks it up.
 *
 * BLD-20260617-DEAD-CASCADE: when the sale died, its direct dependents (e.g.
 * the delivery photo with dependsOn:[sale]) were cascaded to `dead`. Retrying
 * the sale must ALSO rearm those dead dependents back to `pending`, otherwise
 * the photo would never upload even after the sale finally succeeds. dependsOn
 * is preserved, so the photo still waits for the sale to reach `done` again.
 */

import type { SyncQueueItem, SyncItemStatus } from '../types/sync';

const REARMED = {
  status: 'pending' as SyncItemStatus,
  retries: 0,
  next_retry_at: null,
  error_message: null,
};

export function rearmSaleOrderForRetry(
  queue: SyncQueueItem[],
  saleOperationId: string,
): SyncQueueItem[] {
  if (!saleOperationId) return queue;
  return queue.map((item) => {
    // 1) The sale itself: only rearm error/dead (pending/syncing/done untouched).
    if (item.id === saleOperationId) {
      if (item.type !== 'sale_order') return item;
      if (item.status !== 'error' && item.status !== 'dead') return item;
      return { ...item, ...REARMED };
    }
    // 2) Dead dependents of this sale (cascaded by markDead) → back to pending.
    if (item.status === 'dead' && (item.dependsOn ?? []).includes(saleOperationId)) {
      return { ...item, ...REARMED };
    }
    return item;
  });
}
