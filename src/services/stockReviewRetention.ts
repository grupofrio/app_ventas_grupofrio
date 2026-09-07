import type { SyncQueueItem } from '../types/sync.ts';
import { isProtectedPhysicalReviewItem } from './consignmentPhysicalReview.ts';

export function isStockReviewItem(item: {type: string; status?: string; payload?: Record<string, unknown>; error_message?: string | null}): boolean {
  return item.type === 'sale_order' && item.status === 'dead' && (
    item.payload?._stockReviewRequired === true
    || /insufficient[_ ]?stock|stock insuficiente/i.test(item.error_message ?? '')
  );
}

function descendants(queue: SyncQueueItem[], roots: Set<string>): Set<string> {
  const ids = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of queue) {
      if (!ids.has(item.id) && item.dependsOn?.some(id => ids.has(id))) {
        ids.add(item.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function protectedReviewIds(queue: SyncQueueItem[]): Set<string> {
  return descendants(queue, new Set(queue.filter(item => (
    isStockReviewItem(item) || isProtectedPhysicalReviewItem(item)
  )).map(item => item.id)));
}

export function removeUnprotectedDead(queue: SyncQueueItem[], requestedIds?: string[]): SyncQueueItem[] {
  const protectedIds = protectedReviewIds(queue);
  const requested = requestedIds ? new Set(requestedIds) : null;
  return queue.filter(item => item.status !== 'dead' || protectedIds.has(item.id)
    || (requested !== null && !requested.has(item.id)));
}

export function markStockReview(queue: SyncQueueItem[], operationId: string, message: string): SyncQueueItem[] {
  const sale = queue.find(item => item.id === operationId && item.type === 'sale_order' && item.status !== 'done');
  if (!sale) return queue;
  const ids = descendants(queue, new Set([operationId]));
  return queue.map(item => ids.has(item.id) && item.status !== 'done' ? {
    ...item,
    status: 'dead',
    next_retry_at: null,
    error_message: item.id === operationId ? message : 'Pendiente de resolver la venta por inventario.',
    payload: item.id === operationId ? { ...item.payload, _stockReviewRequired: true } : item.payload,
  } : item);
}

export function retryStockReview(queue: SyncQueueItem[], operationId: string): SyncQueueItem[] {
  if (!queue.some(item => item.id === operationId && isStockReviewItem(item))) return queue;
  const ids = descendants(queue, new Set([operationId]));
  const physicalIds = descendants(queue, new Set(queue.filter(isProtectedPhysicalReviewItem).map(item => item.id)));
  return queue.map(item => ids.has(item.id) && !physicalIds.has(item.id) && item.status === 'dead' ? {
    ...item, status: 'pending', retries: 0, next_retry_at: null, error_message: null,
  } : item);
}
