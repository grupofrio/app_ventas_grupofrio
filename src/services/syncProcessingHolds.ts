export interface SyncProcessingHolds {
  hold(ids: string[]): void;
  release(ids: string[]): void;
  isHeld(id: string): boolean;
  withoutHeld<T extends { id: string }>(items: T[]): T[];
}

export interface RunUnlessProcessingHeldInput<T> {
  registry: SyncProcessingHolds;
  id: string;
  heldResult: T;
  onHeld?: () => void;
  run: () => T | Promise<T>;
}

export interface RunUnheldProcessingChunkInput<T extends { id: string }, R> {
  registry: SyncProcessingHolds;
  items: T[];
  run: (items: T[]) => R | Promise<R>;
}

export type RunUnheldProcessingChunkResult<T extends { id: string }, R> =
  | { dispatched: false; items: T[] }
  | { dispatched: true; items: T[]; result: R };

export type SyncProcessingOutcome = 'handled' | 'failed' | 'deferred' | 'dependency_wait';
export type SyncProcessingPriority = 1 | 2 | 3;

export interface SyncCycleMetricsSnapshot {
  processed: number;
  succeeded: number;
  failed: number;
  itemsByPriority: Record<SyncProcessingPriority, number>;
}

export interface SyncCycleMetricsAccumulator {
  recordOutcome(priority: SyncProcessingPriority, outcome: SyncProcessingOutcome): void;
  recordBatch(
    priority: SyncProcessingPriority,
    result: Pick<SyncCycleMetricsSnapshot, 'processed' | 'succeeded' | 'failed'>,
  ): void;
  snapshot(): SyncCycleMetricsSnapshot;
}

function normalizedId(id: string): string {
  return typeof id === 'string' ? id.trim() : '';
}

/**
 * Transient holds deliberately have single-owner batch semantics. A durability
 * batch may hold each operation id once and must release the same ids from its
 * own `finally` block. The Set makes duplicate calls by that owner idempotent;
 * it is intentionally not a refcount and does not support overlapping owners
 * for the same id.
 */
export function createSyncProcessingHolds(): SyncProcessingHolds {
  const heldIds = new Set<string>();

  return {
    hold(ids) {
      for (const id of ids) {
        const normalized = normalizedId(id);
        if (normalized) heldIds.add(normalized);
      }
    },
    release(ids) {
      for (const id of ids) {
        const normalized = normalizedId(id);
        if (normalized) heldIds.delete(normalized);
      }
    },
    isHeld(id) {
      const normalized = normalizedId(id);
      return normalized ? heldIds.has(normalized) : false;
    },
    withoutHeld(items) {
      return items.filter((item) => !heldIds.has(normalizedId(item.id)));
    },
  };
}

export async function runUnlessProcessingHeld<T>(
  input: RunUnlessProcessingHeldInput<T>,
): Promise<T> {
  if (input.registry.isHeld(input.id)) {
    input.onHeld?.();
    return input.heldResult;
  }
  return input.run();
}

export async function runUnheldProcessingChunk<T extends { id: string }, R>(
  input: RunUnheldProcessingChunkInput<T, R>,
): Promise<RunUnheldProcessingChunkResult<T, R>> {
  const items = input.registry.withoutHeld(input.items);
  if (items.length === 0) return { dispatched: false, items };
  return { dispatched: true, items, result: await input.run(items) };
}

export function createSyncCycleMetrics(): SyncCycleMetricsAccumulator {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const itemsByPriority: Record<SyncProcessingPriority, number> = { 1: 0, 2: 0, 3: 0 };

  return {
    recordOutcome(priority, outcome) {
      // A dependency/hold wait did not cross a dispatch boundary and therefore
      // must not be reported as processed or failed.
      if (outcome === 'dependency_wait') return;
      processed++;
      itemsByPriority[priority]++;
      if (outcome === 'handled') succeeded++;
      else if (outcome === 'failed') failed++;
    },
    recordBatch(priority, result) {
      processed += result.processed;
      succeeded += result.succeeded;
      failed += result.failed;
      itemsByPriority[priority] += result.processed;
    },
    snapshot() {
      return {
        processed,
        succeeded,
        failed,
        itemsByPriority: { ...itemsByPriority },
      };
    },
  };
}
