/**
 * Manual retry for a business op that died on a real 4xx rejection.
 * Rearms the same queue id so the next POST reuses operation_id.
 */

import type { SyncQueueItem, SyncItemStatus } from '../types/sync.ts';
import { isProtectedPhysicalReviewItem } from './consignmentPhysicalReview.ts';
import { MANUAL_RECONCILIATION_REQUIRED_MESSAGE } from './syncRetryDecision.ts';
import {
  deadPhotoRetryBlockReason,
  rearmDeadEvidencePhoto,
} from './evidencePhotoSync.ts';
import { rearmSaleOrderForRetry } from './saleRetry.ts';

const REARMED = {
  status: 'pending' as SyncItemStatus,
  retries: 0,
  next_retry_at: null,
  error_message: null,
};

export function deadBusinessRetryBlockReason(
  item: Pick<SyncQueueItem, 'id' | 'type' | 'status' | 'dependsOn' | 'payload' | 'error_message'>,
  queue: Array<Pick<SyncQueueItem, 'id' | 'type' | 'status'>>,
): string | null {
  if (item.type === 'photo') return deadPhotoRetryBlockReason(item, queue);
  if (item.type === 'gps') return 'El GPS se reintenta solo y no bloquea el cierre.';
  if (item.status !== 'dead') return 'Esta operación ya no está pendiente de reintento.';
  if (isProtectedPhysicalReviewItem(item)) {
    return 'Esta entrega física se concilia con Almacén. No se reenvía desde aquí.';
  }
  if (item.error_message === MANUAL_RECONCILIATION_REQUIRED_MESSAGE) {
    return 'Esta operación expiró y requiere reconciliación manual.';
  }
  for (const depId of item.dependsOn ?? []) {
    const dep = queue.find((candidate) => candidate.id === depId);
    if (dep && dep.status === 'dead') {
      return 'Esta operación depende de otra que falló. Reintenta esa primero.';
    }
  }
  return null;
}

export function rearmDeadBusinessItem(queue: SyncQueueItem[], id: string): SyncQueueItem[] {
  const item = queue.find((candidate) => candidate.id === id);
  if (!item || item.status !== 'dead' || item.type === 'gps') return queue;
  if (item.type === 'sale_order') return rearmSaleOrderForRetry(queue, id);
  if (item.type === 'photo') return rearmDeadEvidencePhoto(queue, id);
  let changed = false;
  const next = queue.map((candidate) => {
    if (candidate.id !== id) return candidate;
    changed = true;
    return { ...candidate, ...REARMED };
  });
  return changed ? next : queue;
}
