interface SyncCompletionItem {
  id: string;
  type: string;
}

const saleTerminalMarkerPersistenceErrors = new WeakSet<object>();

export class SaleTerminalMarkerPersistenceError extends Error {
  readonly operationId: string;
  readonly cause: unknown;

  constructor(operationId: string, cause: unknown) {
    super('Unable to persist the terminal sale marker');
    this.name = 'SaleTerminalMarkerPersistenceError';
    this.operationId = operationId;
    this.cause = cause;
    saleTerminalMarkerPersistenceErrors.add(this);
  }
}

export function isSaleTerminalMarkerPersistenceError(
  value: unknown,
): value is SaleTerminalMarkerPersistenceError {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }
  try {
    return saleTerminalMarkerPersistenceErrors.has(value);
  } catch {
    return false;
  }
}

export const SALE_TERMINAL_MARKER_DEFERRED_MESSAGE =
  'sale terminal marker persistence deferred (storage)';

interface SaleTerminalMarkerDeferrableItem {
  id: string;
  type: string;
  status: string;
  retries: number;
  error_message: string | null;
  next_retry_at: number | null;
}

export function applySaleTerminalMarkerDeferral<
  Item extends SaleTerminalMarkerDeferrableItem,
>(
  queue: Item[],
  operationId: string,
  retryAt: number,
): Item[] {
  return queue.map((item) => (
    item.id === operationId && item.type === 'sale_order'
      ? {
          ...item,
          status: 'error',
          error_message: SALE_TERMINAL_MARKER_DEFERRED_MESSAGE,
          retries: 0,
          next_retry_at: retryAt,
        }
      : item
  ));
}

interface ProcessSyncItemToCompletionOptions<Item extends SyncCompletionItem> {
  item: Item;
  process: (item: Item) => Promise<void>;
  markSaleReadyToContinue: (operationId: string) => Promise<boolean>;
  markDone: (operationId: string) => void;
}

export async function processSyncItemToCompletion<Item extends SyncCompletionItem>({
  item,
  process,
  markSaleReadyToContinue,
  markDone,
}: ProcessSyncItemToCompletionOptions<Item>): Promise<void> {
  await process(item);
  if (item.type === 'sale_order') {
    try {
      await markSaleReadyToContinue(item.id);
    } catch (cause: unknown) {
      throw new SaleTerminalMarkerPersistenceError(item.id, cause);
    }
  }
  markDone(item.id);
}
