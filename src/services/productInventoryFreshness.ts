import type { InventorySource } from '../stores/useProductStore.ts';
import type { InventoryFreshness } from './effectiveOfflineCatalog.ts';

export interface InventoryAuthorityInput {
  isOnline: boolean;
  loadedWarehouseId: number | null;
  expectedWarehouseId: number | null;
  inventorySource: InventorySource | null;
  fromCache: boolean;
}

export interface ProductRefreshEntry {
  readonly generation: number;
  readonly contextIdentity: string;
}

export type ProductLoadInvocation = ProductRefreshEntry;

export interface ProductLoadInvocationCheck {
  invocation: ProductLoadInvocation | null;
  currentGeneration: number;
  currentContextIdentity: string | null;
}

export interface ProductRefreshEntryCheck {
  entry: ProductRefreshEntry | null;
  currentGeneration: number;
  currentContextIdentity: string | null;
}

/** Checks an epoch/context snapshot captured before async work is scheduled. */
export function isProductRefreshEntryCurrent(
  input: ProductRefreshEntryCheck,
): boolean {
  const entry = input?.entry;
  return Boolean(
    entry
    && Number.isSafeInteger(entry.generation)
    && entry.generation >= 0
    && Number.isSafeInteger(input.currentGeneration)
    && input.currentGeneration === entry.generation
    && typeof entry.contextIdentity === 'string'
    && entry.contextIdentity.length > 0
    && input.currentContextIdentity === entry.contextIdentity,
  );
}

/**
 * Ensures a caller publishes only facts produced by its exact product load.
 * A direct load, hydration, context switch, or reset advances the generation
 * and makes any older invocation ineligible even if shared state still looks
 * authoritative from an earlier successful request.
 */
export function isProductLoadInvocationCurrent(
  input: ProductLoadInvocationCheck,
): boolean {
  if (!input?.invocation || input.invocation.generation <= 0) return false;
  return isProductRefreshEntryCurrent({
    entry: input.invocation,
    currentGeneration: input.currentGeneration,
    currentContextIdentity: input.currentContextIdentity,
  });
}

export interface ContextSingleFlight<Result> {
  /**
   * Coalesces work for the same context. Starting work for another context
   * supersedes the previous result without trying to cancel its transport.
   */
  run: (
    contextIdentity: string,
    task: () => Promise<Result> | Result,
  ) => Promise<Result>;
  /** Invalidates pending work (for example on logout/reset). */
  invalidate: () => void;
}

/**
 * Serializes publication of context-scoped async results.
 *
 * The active entry is installed before `task` starts, so concurrent callers
 * for the same context receive the exact same Promise. A different context or
 * an explicit invalidation makes the older operation resolve as superseded.
 */
export function createContextSingleFlight<Result>(
  createSupersededResult: () => Result,
): ContextSingleFlight<Result> {
  let generation = 0;
  let active: {
    contextIdentity: string;
    generation: number;
    promise: Promise<Result>;
  } | null = null;

  return {
    run(contextIdentity, task) {
      if (active?.contextIdentity === contextIdentity) return active.promise;

      const operationGeneration = ++generation;
      let entry!: NonNullable<typeof active>;
      const promise = (async () => {
        // Publish `entry` before invoking code that may throw synchronously.
        await Promise.resolve();
        try {
          if (generation !== operationGeneration || active !== entry) {
            return createSupersededResult();
          }
          const result = await task();
          return generation === operationGeneration && active === entry
            ? result
            : createSupersededResult();
        } catch (error) {
          if (generation !== operationGeneration || active !== entry) {
            return createSupersededResult();
          }
          throw error;
        } finally {
          // An old operation must never clear a newer context's active entry.
          if (active === entry) active = null;
        }
      })();
      entry = { contextIdentity, generation: operationGeneration, promise };
      active = entry;
      return promise;
    },
    invalidate() {
      generation += 1;
      active = null;
    },
  };
}

function positiveSafeId(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0;
}

/**
 * Describes how much authority the UI may assign to the current quantities.
 * Connectivity alone is never enough to promote a cached or fallback result.
 */
export function describeInventoryAuthority(
  input: InventoryAuthorityInput,
): InventoryFreshness {
  if (!input || typeof input !== 'object') return 'unknown';
  if (input.fromCache === true) return 'cached';
  if (input.fromCache !== false || input.isOnline !== true) return 'unknown';
  if (
    !positiveSafeId(input.loadedWarehouseId)
    || !positiveSafeId(input.expectedWarehouseId)
    || input.loadedWarehouseId !== input.expectedWarehouseId
  ) {
    return 'unknown';
  }
  return input.inventorySource === 'truck_stock'
    || input.inventorySource === 'stock_quant'
    ? 'authoritative'
    : 'unknown';
}
