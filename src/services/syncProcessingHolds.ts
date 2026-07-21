export interface SyncProcessingHolds {
  hold(ids: string[]): void;
  release(ids: string[]): void;
  isHeld(id: string): boolean;
  withoutHeld<T extends { id: string }>(items: T[]): T[];
}

function normalizedId(id: string): string {
  return typeof id === 'string' ? id.trim() : '';
}

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
