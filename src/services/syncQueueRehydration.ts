import {
  isSyncItemType,
  SYNC_PRIORITY_MAP,
  type SyncItemStatus,
  type SyncQueueItem,
} from '../types/sync.ts';

export interface RestoredSyncQueue {
  queue: SyncQueueItem[];
  discardedCount: number;
  syncingRecoveredCount: number;
}

/**
 * Restores only queue item types that the current client is authorized to
 * dispatch. Unknown persisted records are intentionally excluded before any
 * sync worker can observe them.
 */
export function restorePersistedSyncQueue(saved: unknown[]): RestoredSyncQueue {
  const queue: SyncQueueItem[] = [];
  let discardedCount = 0;
  let syncingRecoveredCount = 0;

  for (const candidate of saved) {
    if (!isQueueItemWithActiveType(candidate)) {
      discardedCount += 1;
      continue;
    }

    const wasSyncing = candidate.status === 'syncing';
    if (wasSyncing) syncingRecoveredCount += 1;
    queue.push({
      ...candidate,
      status: wasSyncing ? ('pending' as SyncItemStatus) : candidate.status,
      priority: candidate.priority ?? SYNC_PRIORITY_MAP[candidate.type],
      next_retry_at: candidate.next_retry_at ?? null,
    });
  }

  return { queue, discardedCount, syncingRecoveredCount };
}

function isQueueItemWithActiveType(candidate: unknown): candidate is SyncQueueItem {
  return (
    typeof candidate === 'object'
    && candidate !== null
    && isSyncItemType((candidate as { type?: unknown }).type)
  );
}
