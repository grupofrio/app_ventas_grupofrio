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

function snapshotArray(value: unknown): unknown[] {
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    return [];
  }
  if (!isArray) return [];
  const arrayValue = value as unknown[];
  let length = 0;
  try {
    length = arrayValue.length;
  } catch {
    return [];
  }
  if (!Number.isSafeInteger(length) || length < 0) return [];

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    try {
      snapshot.push(arrayValue[index]);
    } catch {
      // A hostile element remains unreadable, but cannot break cleanup.
    }
  }
  return snapshot;
}

function exactItemId(value: unknown): string | null {
  const id = readProperty(value, 'id');
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function dependencyIds(value: unknown): string[] {
  return snapshotArray(readProperty(value, 'dependsOn'))
    .filter((candidate): candidate is string => (
      typeof candidate === 'string' && candidate.length > 0
    ));
}

/** Indexes of dead descendants reachable through the real `dependsOn` field. */
export function collectDeadDependencyClosure(
  queue: unknown,
  rootIds: ReadonlySet<string>,
): Set<number> {
  const items = snapshotArray(queue);
  const reachableIds = new Set(rootIds);
  const retainedIndexes = new Set<number>();
  let changed = true;

  while (changed) {
    changed = false;
    for (let index = 0; index < items.length; index += 1) {
      if (retainedIndexes.has(index)) continue;
      const item = items[index];
      if (readProperty(item, 'status') !== 'dead') continue;
      if (!dependencyIds(item).some((dependencyId) => reachableIds.has(dependencyId))) {
        continue;
      }
      retainedIndexes.add(index);
      const id = exactItemId(item);
      if (id && !reachableIds.has(id)) reachableIds.add(id);
      changed = true;
    }
  }

  return retainedIndexes;
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
  let isQueueArray = false;
  try {
    isQueueArray = Array.isArray(queue);
  } catch {
    return { queue: [], removed: 0, protected: 0 };
  }
  if (!isQueueArray) {
    return { queue: [], removed: 0, protected: 0 };
  }

  const items = snapshotArray(queue);
  const protectedRootIndexes = new Set<number>();
  const protectedRootIds = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isProtectedDeadStockSale(item)) continue;
    protectedRootIndexes.add(index);
    const id = exactItemId(item);
    if (id) protectedRootIds.add(id);
  }
  const protectedDependentIndexes = collectDeadDependencyClosure(
    items,
    protectedRootIds,
  );

  const kept: unknown[] = [];
  let removed = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (readProperty(item, 'status') !== 'dead') {
      kept.push(item);
      continue;
    }
    if (
      protectedRootIndexes.has(index)
      || protectedDependentIndexes.has(index)
    ) {
      kept.push(item);
      continue;
    }
    removed += 1;
  }

  return {
    queue: kept,
    removed,
    protected: protectedRootIndexes.size,
  };
}

export interface DeadCleanupDependencies {
  read: () => SyncQueueItem[];
  transformAndPersist: (
    transform: (queue: SyncQueueItem[]) => SyncQueueItem[],
  ) => Promise<void>;
}

export function createDeadCleanupAction(
  dependencies: DeadCleanupDependencies,
): () => Promise<{ removed: number; protected: number }> {
  let active: Promise<{ removed: number; protected: number }> | null = null;

  return (): Promise<{ removed: number; protected: number }> => {
    if (active) return active;

    const task = Promise.resolve().then(async () => {
      const preview = clearUnprotectedDeadItems(dependencies.read());
      if (preview.removed > 0) {
        await dependencies.transformAndPersist((queue) => (
          clearUnprotectedDeadItems(queue).queue
        ));
      }
      return { removed: preview.removed, protected: preview.protected };
    });
    active = task;
    void task.finally(() => {
      if (active === task) active = null;
    }).catch(() => undefined);
    return task;
  };
}
