import type { SyncItemStatus, SyncQueueItem } from '../types/sync.ts';

const ACTIVE_SALE_STATUSES = new Set<SyncItemStatus>([
  'pending',
  'syncing',
  'error',
  'dead',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isActiveSaleQueueItem(
  value: unknown,
): value is Pick<SyncQueueItem, 'id' | 'type' | 'status'> {
  return (
    isRecord(value)
    && value.type === 'sale_order'
    && typeof value.id === 'string'
    && ACTIVE_SALE_STATUSES.has(value.status as SyncItemStatus)
  );
}

export function collectLocalSaleOperationIds(queue: unknown): string[] {
  if (!Array.isArray(queue)) return [];

  const seen = new Set<string>();
  const operationIds: string[] = [];

  for (const item of queue) {
    if (!isActiveSaleQueueItem(item)) continue;
    const normalized = item.id.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    operationIds.push(item.id);
  }

  return operationIds;
}
