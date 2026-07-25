import type { InventoryFreshness } from './effectiveOfflineCatalog.ts';

export type ProductStockPolicy = 'strict' | 'offline_sale';

interface ProductStockContext {
  policy: ProductStockPolicy;
  isOnline: boolean;
  qtyDisplay: number | null;
  freshness: InventoryFreshness;
}

interface ProductQuantityContext extends ProductStockContext {
  requestedQty: number;
}

interface ProductStockLabelContext extends ProductStockContext {
  capturedAtMs?: number | null;
  nowMs?: number;
}

function usesOfflineSaleBypass(input: ProductStockContext): boolean {
  return input.policy === 'offline_sale' && input.isOnline === false;
}

function hasPositiveStock(qtyDisplay: number | null): boolean {
  return typeof qtyDisplay === 'number'
    && Number.isFinite(qtyDisplay)
    && qtyDisplay > 0;
}

function hasValidCartQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity > 0;
}

export function shouldRefreshInventoryAuthority(
  input: Pick<ProductStockContext, 'policy' | 'isOnline' | 'freshness'>,
): boolean {
  return input.policy === 'offline_sale'
    && input.isOnline === true
    && input.freshness !== 'authoritative';
}

export function canSelectProduct(input: ProductStockContext): boolean {
  if (usesOfflineSaleBypass(input)) return true;
  if (shouldRefreshInventoryAuthority(input)) return false;
  return hasPositiveStock(input.qtyDisplay);
}

/**
 * Returns a valid integer quantity for the cart, or null when it must be
 * rejected. Strict paths retain the captured-stock cap. Only the explicit
 * offline-sale policy while actually offline removes that cap.
 */
export function normalizeProductQuantity(
  input: ProductQuantityContext,
): number | null {
  if (!hasValidCartQuantity(input.requestedQty)) return null;
  if (usesOfflineSaleBypass(input)) return input.requestedQty;
  if (shouldRefreshInventoryAuthority(input)) return null;
  if (!hasPositiveStock(input.qtyDisplay)) return null;

  const integerStock = Math.floor(input.qtyDisplay as number);
  return integerStock > 0
    ? Math.min(input.requestedQty, integerStock)
    : null;
}

function formatCapturedAge(capturedAtMs: unknown, nowMs: unknown): string | null {
  if (
    typeof capturedAtMs !== 'number'
    || !Number.isSafeInteger(capturedAtMs)
    || capturedAtMs < 0
    || typeof nowMs !== 'number'
    || !Number.isSafeInteger(nowMs)
    || nowMs < capturedAtMs
  ) {
    return null;
  }

  const elapsedMinutes = Math.floor((nowMs - capturedAtMs) / 60_000);
  if (elapsedMinutes < 1) return 'capturado hace menos de 1 min';
  if (elapsedMinutes < 60) return `capturado hace ${elapsedMinutes} min`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `capturado hace ${elapsedHours} h`;
  return `capturado hace ${Math.floor(elapsedHours / 24)} d`;
}

export function formatProductStockLabel(
  input: ProductStockLabelContext,
): string {
  if (usesOfflineSaleBypass(input)) {
    const age = formatCapturedAge(input.capturedAtMs, input.nowMs ?? Date.now());
    return age ? `Stock sin validar · ${age}` : 'Stock sin validar';
  }
  if (shouldRefreshInventoryAuthority(input)) return 'Actualizando inventario';
  return hasPositiveStock(input.qtyDisplay)
    ? `${input.qtyDisplay} disp.`
    : 'Agotado';
}
