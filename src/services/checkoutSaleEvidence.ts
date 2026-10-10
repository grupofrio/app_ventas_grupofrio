/**
 * F41 / F42 — checkout may say "sale" only when Odoo already accepted a
 * delivery for that stop. That evidence is a done queued sale_order, an
 * online createSale recorded on the visit, or a remote order. A rejected
 * offline sale, a gift, or a cart that was never confirmed does not count.
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

/** Server-accepted sale recorded on the phone when createSale succeeds online. */
export interface AcceptedLocalSale {
  stopId: number;
  orderId: number;
  partnerId: number | null;
  amount: number;
  operationId: string;
  name: string;
  partnerName?: string;
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

export function normalizeAcceptedLocalSale(value: unknown): AcceptedLocalSale | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sale = value as Record<string, unknown>;
  const stopId = positiveStopId(sale.stopId);
  const orderId = positiveStopId(sale.orderId);
  if (stopId == null || orderId == null) return null;
  if (recognizeGift(sale) || sale.isGift === true || sale.is_gift === true) return null;
  const amount = positiveAmount(sale.amount) ?? 0;
  const partnerId = positiveStopId(sale.partnerId);
  return {
    stopId,
    orderId,
    partnerId,
    amount,
    operationId: typeof sale.operationId === 'string' ? sale.operationId : '',
    name: typeof sale.name === 'string' ? sale.name : '',
    ...(typeof sale.partnerName === 'string' ? { partnerName: sale.partnerName } : {}),
  };
}

export function normalizeAcceptedLocalSales(value: unknown): AcceptedLocalSale[] {
  if (!Array.isArray(value)) return [];
  const sales: AcceptedLocalSale[] = [];
  for (const candidate of value) {
    const sale = normalizeAcceptedLocalSale(candidate);
    if (sale) sales.push(sale);
  }
  return sales;
}

/** An online createSale left an order id. A gift never qualifies. */
export function isAcceptedLocalSale(sale: AcceptedLocalSale): boolean {
  return normalizeAcceptedLocalSale(sale) != null;
}

export function hasSyncedSaleForStop(
  stopId: number,
  queue: readonly CheckoutSaleQueueItem[],
  orders: readonly CheckoutRemoteOrder[] = [],
  acceptedSales: readonly AcceptedLocalSale[] = [],
): boolean {
  if (!(stopId > 0)) return false;
  for (const sale of acceptedSales) {
    if (isAcceptedLocalSale(sale) && sale.stopId === stopId) return true;
  }
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
  acceptedSales: readonly AcceptedLocalSale[] = [],
): number | null {
  for (const order of orders) {
    if (!isAcceptedRemoteSale(order) || positiveStopId(order.stop_id) !== stopId) continue;
    const amount = positiveAmount(order.amount_total);
    if (amount != null) return amount;
  }
  for (const sale of acceptedSales) {
    if (!isAcceptedLocalSale(sale) || sale.stopId !== stopId) continue;
    const amount = positiveAmount(sale.amount);
    if (amount != null) return amount;
  }
  for (const item of queue) {
    if (!isAcceptedQueuedSale(item) || queueStopId(item) !== stopId) continue;
    const amount = positiveAmount(item.payload?._clientTotal);
    if (amount != null) return amount;
  }
  return null;
}

export interface SalesOrderMergeRow extends CheckoutRemoteOrder {
  id?: number;
  name?: string;
  partner_id?: number | null;
  operation_id?: string;
}

/**
 * A sales-list refresh must not drop an online sale the list has not returned
 * yet, and must not erase a known stop_id when the server row omits it.
 */
export function mergeSalesOrderRows<T extends SalesOrderMergeRow>(
  remote: readonly T[],
  local: readonly T[],
): T[] {
  const localById = new Map<number, T>();
  for (const order of local) {
    if (typeof order.id === 'number' && order.id > 0) localById.set(order.id, order);
  }
  const merged = remote.map((order) => {
    const previous = typeof order.id === 'number' && order.id > 0
      ? localById.get(order.id)
      : undefined;
    if (previous && typeof order.id === 'number') localById.delete(order.id);
    if (!previous) return order;
    const remoteAmount = positiveAmount(order.amount_total);
    const remoteLines = Array.isArray(order.lines) ? order.lines : [];
    const previousLines = Array.isArray(previous.lines) ? previous.lines : [];
    return {
      ...previous,
      ...order,
      stop_id: positiveStopId(order.stop_id) ?? previous.stop_id ?? null,
      partner_id: positiveStopId(order.partner_id) ?? previous.partner_id ?? null,
      amount_total: remoteAmount ?? positiveAmount(previous.amount_total) ?? order.amount_total ?? 0,
      lines: remoteLines.length > 0 ? remoteLines : previousLines,
      is_gift: order.is_gift === true ? true : order.is_gift === false ? false : previous.is_gift,
      name: typeof order.name === 'string' && order.name.trim() ? order.name : previous.name,
      operation_id: typeof order.operation_id === 'string' && order.operation_id
        ? order.operation_id
        : previous.operation_id,
    };
  });
  return [...merged, ...localById.values()];
}

/**
 * Local evidence first. When the phone is online and nothing local proves a
 * sale, ask the server once before deciding no_sale.
 */
export async function resolveSyncedSaleForStop(input: {
  stopId: number;
  queue: readonly CheckoutSaleQueueItem[];
  orders: readonly CheckoutRemoteOrder[];
  acceptedSales?: readonly AcceptedLocalSale[];
  isOnline: boolean;
  fetchRemoteOrders?: () => Promise<readonly CheckoutRemoteOrder[]>;
}): Promise<{ hasSyncedSale: boolean; fetchedOrders: CheckoutRemoteOrder[] }> {
  const acceptedSales = input.acceptedSales ?? [];
  if (hasSyncedSaleForStop(input.stopId, input.queue, input.orders, acceptedSales)) {
    return { hasSyncedSale: true, fetchedOrders: [] };
  }
  if (!input.isOnline || !input.fetchRemoteOrders) {
    return { hasSyncedSale: false, fetchedOrders: [] };
  }
  try {
    const fetchedOrders = [...await input.fetchRemoteOrders()];
    return {
      hasSyncedSale: hasSyncedSaleForStop(
        input.stopId,
        input.queue,
        [...input.orders, ...fetchedOrders],
        acceptedSales,
      ),
      fetchedOrders,
    };
  } catch {
    return { hasSyncedSale: false, fetchedOrders: [] };
  }
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
