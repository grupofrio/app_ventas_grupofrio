import type { SyncQueueItem } from '../types/sync.ts';

export interface DeadCleanupResult<Item> {
  queue: Item[];
  removed: number;
  protected: number;
}

function readProperty(value: unknown, property: string): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  try {
    return (value as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
}

function normalizedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function isProtectedDeadStockSale(value: unknown): boolean {
  return readProperty(value, 'status') === 'dead'
    && readProperty(value, 'type') === 'sale_order'
    && normalizedString(readProperty(value, 'error_code')) === 'insufficient_stock';
}

export function clearUnprotectedDeadItems(
  queue: SyncQueueItem[],
): DeadCleanupResult<SyncQueueItem>;
export function clearUnprotectedDeadItems(
  queue: unknown,
): DeadCleanupResult<unknown>;
export function clearUnprotectedDeadItems(
  queue: unknown,
): DeadCleanupResult<unknown> {
  if (!Array.isArray(queue)) {
    return { queue: [], removed: 0, protected: 0 };
  }

  const kept: unknown[] = [];
  let removed = 0;
  let protectedCount = 0;

  for (const item of queue) {
    if (readProperty(item, 'status') !== 'dead') {
      kept.push(item);
      continue;
    }
    if (isProtectedDeadStockSale(item)) {
      kept.push(item);
      protectedCount += 1;
      continue;
    }
    removed += 1;
  }

  return { queue: kept, removed, protected: protectedCount };
}
