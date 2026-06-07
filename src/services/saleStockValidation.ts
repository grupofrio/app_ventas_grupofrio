/**
 * Fresh stock revalidation for sale confirmation (P0-1 frontend-safe).
 *
 * The cart caps quantities against the stock captured WHEN the line was added
 * (SaleLineItem.stock). That value goes stale if the catalog refreshes (another
 * sale synced, refill, etc.). Before confirming a sale we re-check each line
 * against the CURRENT qty_display from the product store, and reject quantities
 * that are <= 0, NaN, or exceed fresh availability.
 *
 * This is a DEFENSIVE frontend gate only — it does NOT mutate inventory and does
 * NOT replace backend validation (see docs/KOLDFIELD_BACKEND_HARDENING_REQUESTS.md).
 * Pure + testable: no network, no RN.
 */

export interface StockLine {
  productId: number;
  productName: string;
  qty: number;
}

export interface StockProduct {
  id: number;
  qty_display?: number;
}

export interface FreshStockIssue {
  productId: number;
  name: string;
  requested: number;
  available: number;
  kind: 'invalid_qty' | 'over_stock' | 'unknown_product';
}

function freshAvailable(products: StockProduct[], productId: number): number | null {
  const p = products.find((x) => x.id === productId);
  if (!p) return null;
  const n = typeof p.qty_display === 'number' ? p.qty_display : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns the list of lines that fail fresh-stock validation. Empty array means
 * the cart is safe to confirm.
 *
 * @param lines     cart lines
 * @param products  current product store snapshot (use getState().products)
 * @param options.requireKnownProduct  when true, a line whose product is not in
 *        the snapshot is flagged (reference/global mode may legitimately omit
 *        stock data, so default is false to avoid false positives).
 */
export function findFreshStockIssues(
  lines: StockLine[],
  products: StockProduct[],
  options: { requireKnownProduct?: boolean } = {},
): FreshStockIssue[] {
  const issues: FreshStockIssue[] = [];
  for (const line of lines) {
    // Always reject incoherent quantities regardless of stock data.
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      issues.push({
        productId: line.productId,
        name: line.productName,
        requested: line.qty,
        available: 0,
        kind: 'invalid_qty',
      });
      continue;
    }
    const available = freshAvailable(products, line.productId);
    if (available === null) {
      if (options.requireKnownProduct) {
        issues.push({
          productId: line.productId,
          name: line.productName,
          requested: line.qty,
          available: 0,
          kind: 'unknown_product',
        });
      }
      continue; // no fresh stock data → don't block (backend is source of truth)
    }
    if (line.qty > available) {
      issues.push({
        productId: line.productId,
        name: line.productName,
        requested: line.qty,
        available,
        kind: 'over_stock',
      });
    }
  }
  return issues;
}
