/**
 * F41 — checkout may say "sale" only when Odoo already accepted a delivery
 * for that stop. A rejected offline sale, a gift, or a cart that was never
 * confirmed does not create delivery lines, and action_checkout rejects
 * result_status=sale in that case.
 */

import { recognizeGift } from './giftRecognition.ts';

export interface CheckoutSaleQueueItem {
  id: string;
  type: string;
  status: string;
  payload?: Record<string, unknown> | null;
}

export interface CheckoutRemoteOrder {
  stop_id?: number | null;
  is_gift?: unknown;
  client_order_ref?: unknown;
  origin?: unknown;
  amount_total?: number | null;
  lines?: unknown[] | null;
}

export type CheckoutSaleSyncStatus = 'none' | 'pending' | 'done' | 'failed';

export type CheckoutSalePresentation =
  | { kind: 'synced'; amount: number }
  | { kind: 'pending'; amount: number }
  | { kind: 'none' };

function positiveStopId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function queueStopId(item: CheckoutSaleQueueItem): number | null {
  return positiveStopId(item.payload?.stop_id);
}

function positiveAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Server accepted this queued sale (status done), and it is not a gift. */
export function isAcceptedQueuedSale(item: CheckoutSaleQueueItem): boolean {
  if (item.type !== 'sale_order' || item.status !== 'done' || queueStopId(item) == null) return false;
  return !recognizeGift(item.payload);
}

/** A remote order counts only when it is a real sale with delivery value. */
export function isAcceptedRemoteSale(order: CheckoutRemoteOrder): boolean {
  if (positiveStopId(order.stop_id) == null) return false;
  if (recognizeGift(order)) return false;
  const lineCount = Array.isArray(order.lines) ? order.lines.length : 0;
  return lineCount > 0 || positiveAmount(order.amount_total) != null;
}

export function hasSyncedSaleForStop(
  stopId: number,
  queue: readonly CheckoutSaleQueueItem[],
  orders: readonly CheckoutRemoteOrder[] = [],
): boolean {
  if (!(stopId > 0)) return false;
  for (const item of queue) {
    if (isAcceptedQueuedSale(item) && queueStopId(item) === stopId) return true;
  }
  for (const order of orders) {
    if (isAcceptedRemoteSale(order) && positiveStopId(order.stop_id) === stopId) return true;
  }
  return false;
}

export function syncedSaleAmountForStop(
  stopId: number,
  queue: readonly CheckoutSaleQueueItem[],
  orders: readonly CheckoutRemoteOrder[] = [],
): number | null {
  for (const order of orders) {
    if (!isAcceptedRemoteSale(order) || positiveStopId(order.stop_id) !== stopId) continue;
    const amount = positiveAmount(order.amount_total);
    if (amount != null) return amount;
  }
  for (const item of queue) {
    if (!isAcceptedQueuedSale(item) || queueStopId(item) !== stopId) continue;
    const amount = positiveAmount(item.payload?._clientTotal);
    if (amount != null) return amount;
  }
  return null;
}

/**
 * saleTotal passed to getCheckoutResultStatus. Zero forces no_sale.
 * A synced sale with an empty cart still has to be "sale" (the lines already
 * left the phone), so the sentinel is 1.
 */
export function checkoutResultSaleTotal(hasSyncedSale: boolean, cartTotal: number): number {
  if (!hasSyncedSale) return 0;
  return cartTotal > 0 ? cartTotal : 1;
}

/** Status actually sent to action_checkout. A cart total never decides this. */
export function resolveCheckoutResultStatus(hasSyncedSale: boolean): 'sale' | 'no_sale' {
  return hasSyncedSale ? 'sale' : 'no_sale';
}

export function describeCheckoutSalePresentation(input: {
  hasSyncedSale: boolean;
  saleSyncStatus: CheckoutSaleSyncStatus;
  cartTotal: number;
  syncedAmount?: number | null;
}): CheckoutSalePresentation {
  if (input.hasSyncedSale) {
    const synced = input.syncedAmount != null && input.syncedAmount > 0
      ? input.syncedAmount
      : input.cartTotal;
    return { kind: 'synced', amount: synced > 0 ? synced : 0 };
  }
  if (input.saleSyncStatus === 'pending' && input.cartTotal > 0) {
    return { kind: 'pending', amount: input.cartTotal };
  }
  return { kind: 'none' };
}

export function isMissingDeliveryLinesCheckoutError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /l[ií]nea(?:s)? de entrega/i.test(message);
}

/**
 * One retry as no_sale when Odoo rejected result_status=sale for lack of
 * delivery lines. Returns true when the retry ran and succeeded.
 */
export async function retryCheckoutAsNoSale(
  error: unknown,
  attempted: 'sale' | 'no_sale',
  retry: () => Promise<unknown>,
): Promise<boolean> {
  if (attempted !== 'sale') return false;
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!isMissingDeliveryLinesCheckoutError(message)) return false;
  await retry();
  return true;
}

export function shouldDiscardRejectedSaleCart(input: {
  saleOperationId: string | null;
  currentStopId: number | null;
  saleLineCount: number;
  rejectedOperationId: string;
  rejectedStopId: number | null;
}): boolean {
  if (input.saleOperationId && input.saleOperationId === input.rejectedOperationId) {
    return true;
  }
  if (input.saleLineCount <= 0) return false;
  return input.saleOperationId == null
    && input.currentStopId != null
    && input.rejectedStopId != null
    && input.currentStopId === input.rejectedStopId;
}
