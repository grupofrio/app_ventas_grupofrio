import type { SyncQueueItem } from '../types/sync';

const PHYSICAL_CONSIGNMENT_TYPES = new Set([
  'consignment_create',
  'consignment_visit',
  'consignment_close',
]);

/**
 * A terminal server rejection cannot prove that physical product returned to
 * the van. Keep the ledger evidence for a human reconciliation instead of
 * synthesizing a local stock reversal.
 */
export function requiresConsignmentPhysicalReview(
  item: Pick<SyncQueueItem, 'type' | 'payload'>,
): boolean {
  return item.payload?._ledgerApplied === true
    && PHYSICAL_CONSIGNMENT_TYPES.has(item.type);
}

/** Review evidence is never generic sync history and must not be purged. */
export function isProtectedPhysicalReviewItem(
  item: Pick<SyncQueueItem, 'status' | 'payload'>,
): boolean {
  return item.status === 'dead'
    && item.payload?._consignmentPhysicalDeliveryReviewRequired === true;
}
