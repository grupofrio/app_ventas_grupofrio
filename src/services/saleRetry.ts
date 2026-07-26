/**
 * Pure helper and injected coordinator to rearm a failed sale_order item back
 * to pending so the sync processor will retry it without changing its id.
 *
 * Why this is needed:
 *   markError / markDead are forward-only transitions in the V2 state machine.
 *   The public retry action therefore composes this transformation with strict
 *   persistence before publishing it. Keeping the transformation pure lets us
 *   test the rules without spinning up Zustand or React Native:
 *
 *   - Only the matching {id, type:'sale_order'} item is touched.
 *   - retries → 0 so the next cycle isn't gated by MAX_RETRIES.
 *   - next_retry_at → null so backoff doesn't postpone the retry.
 *   - error_message → null so the UI banner clears immediately.
 *   - status → 'pending' so processQueue picks it up.
 *
 * BLD-20260617-DEAD-CASCADE: when the sale died, its direct dependents (e.g.
 * the delivery photo with dependsOn:[sale]) were cascaded to `dead`. Retrying
 * the sale must ALSO rearm those dead dependents back to `pending`, otherwise
 * the photo would never upload even after the sale finally succeeds. dependsOn
 * is preserved, so the photo still waits for the sale to reach `done` again.
 */

import type { SyncQueueItem, SyncItemStatus } from '../types/sync';
import { isProtectedStockSyncItem } from './syncErrorClassification.ts';

const REARMED = {
  status: 'pending' as SyncItemStatus,
  retries: 0,
  next_retry_at: null,
  error_message: null,
  error_code: null,
};

export function rearmSaleOrderForRetry(
  queue: SyncQueueItem[],
  saleOperationId: string,
): SyncQueueItem[] {
  if (!saleOperationId) return queue;
  const target = queue.find((item) => (
    item.id === saleOperationId && item.type === 'sale_order'
  ));
  const targetCanBeRearmed = target !== undefined && (
    target.status === 'error'
    || target.status === 'dead'
    || (target.status === 'pending' && isProtectedStockSyncItem(target))
  );
  if (!targetCanBeRearmed) return queue;

  return queue.map((item) => {
    // 1) The sale itself: error/dead, plus a recovered protected pending state.
    if (item.id === saleOperationId && item.type === 'sale_order') {
      return { ...item, ...REARMED };
    }
    // 2) Dead dependents of this sale (cascaded by markDead) → back to pending.
    if (item.status === 'dead' && (item.dependsOn ?? []).includes(saleOperationId)) {
      return { ...item, ...REARMED };
    }
    return item;
  });
}

export interface SaleOrderRetryState {
  queue: SyncQueueItem[];
  isOnline: boolean;
}

export interface SaleOrderRetryDependencies {
  read: () => SaleOrderRetryState;
  persistAndPublish: (
    transform: (queue: SyncQueueItem[]) => SyncQueueItem[],
  ) => Promise<void>;
  processQueue: () => Promise<void>;
}

function normalizeExactOperationId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized === value ? normalized : null;
}

export function isRetryableProtectedSaleOrder(item: unknown): boolean {
  if (!isProtectedStockSyncItem(item)) return false;
  let status: unknown;
  try {
    status = (item as Record<string, unknown>).status;
  } catch {
    return false;
  }
  return status === 'dead' || status === 'error' || status === 'pending';
}

export function createSaleOrderRetryAction(
  dependencies: SaleOrderRetryDependencies,
): (operationId: string) => Promise<void> {
  const inFlight = new Map<string, Promise<void>>();

  return (operationId: string): Promise<void> => {
    const normalizedOperationId = normalizeExactOperationId(operationId);
    if (!normalizedOperationId) {
      return Promise.reject(new Error('Identificador de operación inválido.'));
    }

    const active = inFlight.get(normalizedOperationId);
    if (active) return active;

    const task = Promise.resolve().then(async () => {
      const state = dependencies.read();
      if (!state.isOnline) {
        throw new Error('Se necesita conexión para reintentar esta venta.');
      }
      const target = state.queue.find((item) => item.id === normalizedOperationId);
      if (!isRetryableProtectedSaleOrder(target)) {
        throw new Error('La venta no es una operación protegida por stock insuficiente.');
      }

      await dependencies.persistAndPublish((queue) => (
        rearmSaleOrderForRetry(queue, normalizedOperationId)
      ));
      await dependencies.processQueue();
    });

    inFlight.set(normalizedOperationId, task);
    void task.finally(() => {
      if (inFlight.get(normalizedOperationId) === task) {
        inFlight.delete(normalizedOperationId);
      }
    }).catch(() => undefined);
    return task;
  };
}
