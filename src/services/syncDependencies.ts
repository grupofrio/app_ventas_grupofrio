export interface SyncDependencyItem {
  id: string;
  status: string;
  dependsOn?: string[];
}

export function areSyncDependenciesSatisfied(
  item: SyncDependencyItem,
  fullQueue: SyncDependencyItem[],
): boolean {
  const deps = item.dependsOn ?? [];
  if (deps.length === 0) return true;

  const byId = new Map(fullQueue.map((queueItem) => [queueItem.id, queueItem]));
  return deps.every((depId) => {
    const dep = byId.get(depId);
    return !dep || dep.status === 'done';
  });
}
