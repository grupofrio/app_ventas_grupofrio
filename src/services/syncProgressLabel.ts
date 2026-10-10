/**
 * Dead items stay in the queue until the seller retries or deletes them.
 * They must not inflate the synced numerator.
 */
export function syncedOperationCount(input: {
  totalItems: number;
  pendingCount: number;
  deadCount: number;
}): number {
  const total = Math.max(0, input.totalItems);
  const pending = Math.max(0, input.pendingCount);
  const dead = Math.max(0, input.deadCount);
  return Math.max(0, total - pending - dead);
}

export function formatSyncedOperations(input: {
  totalItems: number;
  pendingCount: number;
  deadCount: number;
}): string {
  return `${syncedOperationCount(input)}/${Math.max(0, input.totalItems)}`;
}
