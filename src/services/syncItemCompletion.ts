interface SyncCompletionItem {
  id: string;
  type: string;
}

interface SaleTicketOdooFolioCompletionItem extends SyncCompletionItem {
  payload: Record<string, unknown>;
}

const SALE_TICKET_ODOO_CONFIRMATION_KEY = '_saleOdooConfirmation';

const saleTerminalMarkerPersistenceErrors = new WeakSet<object>();
const saleTicketFolioPromotionPersistenceErrors = new WeakSet<object>();

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

export class SaleTicketFolioPromotionPersistenceError extends Error {
  readonly operationId: string;
  readonly odooFolio: string;
  readonly cause: unknown;

  constructor(operationId: string, odooFolio: string, cause: unknown) {
    super('Unable to persist the sale ticket Odoo folio');
    this.name = 'SaleTicketFolioPromotionPersistenceError';
    this.operationId = operationId;
    this.odooFolio = odooFolio;
    this.cause = cause;
    saleTicketFolioPromotionPersistenceErrors.add(this);
  }
}

export function isSaleTicketFolioPromotionPersistenceError(
  value: unknown,
): value is SaleTicketFolioPromotionPersistenceError {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }
  try {
    return saleTicketFolioPromotionPersistenceErrors.has(value);
  } catch {
    return false;
  }
}

export async function runSaleTicketFolioPromotion<Result>(
  operationId: string,
  odooFolio: string,
  promote: () => Promise<Result>,
): Promise<Result> {
  try {
    return await promote();
  } catch (cause: unknown) {
    throw new SaleTicketFolioPromotionPersistenceError(operationId, odooFolio, cause);
  }
}

export function readSaleTicketOdooConfirmation(payload: unknown): string | null {
  try {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    const confirmation = (payload as Record<string, unknown>)[SALE_TICKET_ODOO_CONFIRMATION_KEY];
    if (
      typeof confirmation !== 'object'
      || confirmation === null
      || Array.isArray(confirmation)
    ) {
      return null;
    }
    const record = confirmation as Record<string, unknown>;
    if (record.phase !== 'created' || typeof record.odooFolio !== 'string') return null;
    const odooFolio = record.odooFolio.trim();
    return odooFolio || null;
  } catch {
    return null;
  }
}

interface SaleTicketOdooConfirmationItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export function applySaleTicketOdooConfirmation<
  Item extends SaleTicketOdooConfirmationItem,
>(queue: Item[], operationId: string, odooFolioValue: string): Item[] {
  const odooFolio = odooFolioValue.trim();
  if (!odooFolio) return queue;
  return queue.map((item) => (
    item.id === operationId && item.type === 'sale_order'
      ? {
          ...item,
          payload: {
            ...item.payload,
            [SALE_TICKET_ODOO_CONFIRMATION_KEY]: {
              phase: 'created',
              odooFolio,
            },
          },
        }
      : item
  ));
}

interface RunSaleTicketOdooFolioCompletionOptions<Result> {
  item: SaleTicketOdooFolioCompletionItem;
  createSale: () => Promise<{ name: string }>;
  persistRemoteConfirmation: (
    operationId: string,
    odooFolio: string,
  ) => Promise<void>;
  promote: (operationId: string, odooFolio: string) => Promise<Result>;
}

export async function runSaleTicketOdooFolioCompletion<Result>({
  item,
  createSale,
  persistRemoteConfirmation,
  promote,
}: RunSaleTicketOdooFolioCompletionOptions<Result>): Promise<Result> {
  let odooFolio = readSaleTicketOdooConfirmation(item.payload);
  if (odooFolio === null) {
    const saleResult = await createSale();
    odooFolio = saleResult.name.trim();
    if (!odooFolio) throw new Error('Remote sale confirmation did not include an Odoo folio');
    try {
      await persistRemoteConfirmation(item.id, odooFolio);
    } catch (cause: unknown) {
      throw new SaleTicketFolioPromotionPersistenceError(item.id, odooFolio, cause);
    }
  }
  return runSaleTicketFolioPromotion(
    item.id,
    odooFolio,
    () => promote(item.id, odooFolio),
  );
}

export const SALE_TERMINAL_MARKER_DEFERRED_MESSAGE =
  'sale terminal marker persistence deferred (storage)';
export const SALE_TICKET_FOLIO_PROMOTION_DEFERRED_MESSAGE =
  'sale ticket folio promotion persistence deferred (storage)';

interface SaleTerminalMarkerDeferrableItem {
  id: string;
  type: string;
  status: string;
  retries: number;
  error_message: string | null;
  next_retry_at: number | null;
}

interface SaleTicketFolioDeferrableItem extends SaleTerminalMarkerDeferrableItem {
  payload: Record<string, unknown>;
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

export function applySaleTicketFolioPromotionDeferral<
  Item extends SaleTicketFolioDeferrableItem,
>(
  queue: Item[],
  operationId: string,
  odooFolio: string,
  retryAt: number,
): Item[] {
  const confirmedQueue = applySaleTicketOdooConfirmation(queue, operationId, odooFolio);
  return confirmedQueue.map((item) => (
    item.id === operationId && item.type === 'sale_order'
      ? {
          ...item,
          status: 'error',
          error_message: SALE_TICKET_FOLIO_PROMOTION_DEFERRED_MESSAGE,
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
