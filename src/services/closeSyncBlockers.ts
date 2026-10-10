/**
 * Route close and cash close count unfinished sync work. A lead note is not
 * that work: it retries in the background and must not block or warn-block
 * cierre de ruta or corte, even while gf/lead/note is still 404.
 *
 * GPS telemetry is the same kind of background work. A 503 must not raise
 * the syncing flag or the pending/error/dead counters those screens read.
 */

export interface CloseSyncQueueItem {
  type: string;
  status: string;
}

export interface CloseBlockingSyncCounts {
  pendingCount: number;
  errorCount: number;
  deadCount: number;
}

const BACKGROUND_SYNC_TYPES = new Set(['lead_note', 'gps']);

export function isCloseBlockingSyncItem(item: Pick<CloseSyncQueueItem, 'type'>): boolean {
  return !BACKGROUND_SYNC_TYPES.has(item.type);
}

/** Pending, error, and dead totals that cierre de ruta and corte are allowed to see. */
export function countCloseBlockingSyncItems(queue: CloseSyncQueueItem[]): CloseBlockingSyncCounts {
  const blocking = queue.filter(isCloseBlockingSyncItem);
  return {
    pendingCount: blocking.filter((item) => item.status === 'pending').length,
    errorCount: blocking.filter((item) => item.status === 'error').length,
    deadCount: blocking.filter((item) => item.status === 'dead').length,
  };
}

/**
 * A cycle that only retries lead notes must not raise the global syncing flag.
 * That flag is what the close screens read as "espera a que termine".
 */
export function shouldExposeCloseSyncing(candidates: Array<Pick<CloseSyncQueueItem, 'type'>>): boolean {
  return candidates.some((item) => isCloseBlockingSyncItem(item));
}
