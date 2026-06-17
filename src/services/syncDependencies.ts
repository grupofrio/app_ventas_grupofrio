import type { SyncQueueItem, SyncItemStatus, SyncItemType } from '../types/sync';

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

// ── Cascada de fallo definitivo a dependientes (BLD-20260617-DEAD-CASCADE) ────
//
// Una foto/operación con `dependsOn:[venta]` solo se procesa cuando la venta
// llega a `done` (ver areSyncDependenciesSatisfied). Si la venta muere (`dead`)
// el dependiente NUNCA podrá enviarse, pero quedaría `pending` para siempre —
// inflando pendingCount y bloqueando cashclose/route-close sin escape (clearDead
// solo borra `dead`). La regla: cuando un padre muere, sus dependientes directos
// "vivos" (pending/syncing/error) también pasan a `dead` con un mensaje claro,
// para que (a) no parezcan pendientes normales, (b) se limpien junto al padre con
// clearDead, (c) un retry de la venta pueda rearmarlos.

/** Mensaje legible para un dependiente bloqueado por la muerte de su padre. */
export function dependencyBlockedMessage(type?: SyncItemType | string): string {
  return type === 'photo'
    ? 'Foto no enviada porque la venta falló'
    : 'No enviada: depende de una operación que falló';
}

/**
 * Ids de items que dependen DIRECTAMENTE de `parentId` y siguen "vivos"
 * (pending | syncing | error) — los que deben cascada al morir el padre.
 * Excluye done (ya completados) y dead (ya gestionados).
 */
export function findLiveDependents(
  parentId: string,
  queue: Array<Pick<SyncQueueItem, 'id' | 'status' | 'dependsOn'>>,
): string[] {
  if (!parentId) return [];
  return queue
    .filter(
      (i) =>
        (i.dependsOn ?? []).includes(parentId) &&
        i.status !== 'done' &&
        i.status !== 'dead',
    )
    .map((i) => i.id);
}

/**
 * Devuelve una nueva cola donde los dependientes directos vivos de un padre
 * muerto pasan a `dead` con mensaje y sin reintento agendado. Pura: no muta la
 * entrada. Padre ya marcado `dead` por el caller (markDead). Items sin relación
 * se devuelven por referencia (sin cambios) — gps/gift/no_sale normales intactos.
 */
export function cascadeDeadToDependents(
  queue: SyncQueueItem[],
  deadParentId: string,
): SyncQueueItem[] {
  if (!deadParentId) return queue;
  return queue.map((item) => {
    if (!(item.dependsOn ?? []).includes(deadParentId)) return item;
    if (item.status === 'done' || item.status === 'dead') return item;
    return {
      ...item,
      status: 'dead' as SyncItemStatus,
      error_message: dependencyBlockedMessage(item.type),
      next_retry_at: null,
    };
  });
}
