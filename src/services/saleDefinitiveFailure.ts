import type { SyncQueueItem } from '../types/sync.ts';

export const SALE_DEFINITIVE_CLEAR_DEFERRED_MESSAGE =
  'sale definitive rejection clear deferred (storage)';

export function applySaleDefinitiveClearDeferral(
  queue: SyncQueueItem[],
  operationId: string,
  retryAt: number,
): SyncQueueItem[] {
  return queue.map((item) => (
    item.type === 'sale_order' && item.id === operationId
      ? {
          ...item,
          status: 'error',
          error_message: SALE_DEFINITIVE_CLEAR_DEFERRED_MESSAGE,
          retries: 0,
          next_retry_at: retryAt,
        }
      : item
  ));
}

export async function gateSaleDefinitiveFailure({
  item,
  clearMatchingVisit,
}: {
  item: Pick<SyncQueueItem, 'id' | 'type'>;
  clearMatchingVisit: (operationId: string) => Promise<boolean>;
}): Promise<'proceed' | 'deferred'> {
  if (item.type !== 'sale_order') return 'proceed';
  try {
    await clearMatchingVisit(item.id);
    return 'proceed';
  } catch {
    return 'deferred';
  }
}
