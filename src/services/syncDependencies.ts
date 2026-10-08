import type { SyncQueueItem, SyncItemStatus, SyncItemType } from '../types/sync';
import { isEvidencePhotoReleased } from './evidencePhotoSync.ts';

export interface SyncDependencyItem {
  id: string;
  status: string;
  dependsOn?: string[];
  type?: string;
  retries?: number;
  created_at?: number;
}

/**
 * A dependency is met when it is gone, done, or it is an evidence photo that
 * has been released (dead, too many attempts, or older than the wait window).
 * Non-photo parents, including a dead sale, still block their dependents.
 */
export function isSyncDependencyMet(
  dep: SyncDependencyItem | undefined,
  now: number,
): boolean {
  if (!dep) return true;
  if (dep.status === 'done') return true;
  return isEvidencePhotoReleased(dep, now);
}

export function areSyncDependenciesSatisfied(
  item: SyncDependencyItem,
  fullQueue: SyncDependencyItem[],
  now: number = Date.now(),
): boolean {
  const deps = item.dependsOn ?? [];
  if (deps.length === 0) return true;

  const byId = new Map(fullQueue.map((queueItem) => [queueItem.id, queueItem]));
  return deps.every((depId) => isSyncDependencyMet(byId.get(depId), now));
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
  const parent = queue.find((item) => item.id === deadParentId);
  return queue.map((item) => {
    if (!(item.dependsOn ?? []).includes(deadParentId)) return item;
    if (item.status === 'done' || item.status === 'dead') return item;
    // A failed evidence photo must not kill the close that was waiting for it.
    if (
      parent?.type === 'photo'
      && (item.type === 'checkout' || item.type === 'offroute_visit_close')
    ) {
      return item;
    }
    return {
      ...item,
      status: 'dead' as SyncItemStatus,
      error_message: dependencyBlockedMessage(item.type),
      next_retry_at: null,
    };
  });
}
