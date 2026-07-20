/**
 * Sync queue types for offline operations.
 * V2: Added priority classification, 'dead' status, GPS batching support,
 *     device tracking, and backoff scheduling.
 *
 * BLD-008 -- `meta` holds client-side event timing (optional).
 * BLD-010 -- `dependsOn` holds ids of queue items that must reach `done`
 *            before this item is processed.
 */

import type { ClientEventMeta } from '../utils/clientEvent';

export type SyncItemType =
  | 'sale_order'
  | 'checkin'
  | 'checkout'
  | 'photo'
  | 'no_sale'
  | 'payment'
  | 'prospection'
  | 'offroute_visit_close'
  | 'gps'
  | 'gift'
  // V2 additions:
  | 'collection'
  | 'transfer'
  | 'customer_create'
  | 'customer_update';

/**
 * V2 status machine:
 *   pending -> syncing -> done
 *                      -> error -> pending (retry < MAX)
 *                               -> dead   (retry >= MAX, rollback triggered)
 */
export type SyncItemStatus = 'pending' | 'syncing' | 'done' | 'error' | 'dead';

/**
 * Priority levels:
 *   1 = business operations (sales, check-in/out, payments) -- ALWAYS first
 *   2 = media (photos) -- after business
 *   3 = telemetry (GPS, client events) -- last, never blocks business
 */
export type SyncPriority = 1 | 2 | 3;

/** Map each type to its processing priority. */
export const SYNC_PRIORITY_MAP: Record<SyncItemType, SyncPriority> = {
  checkin: 1,
  checkout: 1,
  sale_order: 1,
  no_sale: 1,
  payment: 1,
  collection: 1,
  transfer: 1,
  customer_create: 1,
  customer_update: 1,
  prospection: 1,
  offroute_visit_close: 1,
  gift: 1,
  photo: 2,
  gps: 3,
};

export interface SyncQueueItem {
  id: string; // uuid -- also used as x_client_op_uuid / idempotency key
  type: SyncItemType;
  payload: Record<string, unknown>;
  status: SyncItemStatus;
  created_at: number; // timestamp ms
  retries: number;
  error_message: string | null;

  /** V2: processing priority (1=business, 2=media, 3=telemetry). */
  priority: SyncPriority;

  /**
   * V2: earliest timestamp (ms) at which this item should be retried.
   * null means "ready now". Set after error with backoff calculation.
   */
  next_retry_at: number | null;

  // BLD-008: captured at enqueue time, survives offline, sent on sync
  // only if the client-meta feature flag is enabled.
  meta?: ClientEventMeta;

  // BLD-010: ids of other queue items that must be `done` before this
  // item is processed. Missing / empty array = legacy FIFO behaviour.
  dependsOn?: string[];
}
