export function shouldAutoLoadProducts(
  _warehouseId: number | null | undefined,
  productCount: number,
  isLoading: boolean,
  lastSyncMs: number | null = null,
  error: string | null = null,
): boolean {
  return productCount === 0
    && !isLoading
    && !lastSyncMs
    && !error;
}

/**
 * Read-only freshness decision for a focus-triggered inventory request.
 * Callers must use a stable focus callback: isLoading/error changes are not
 * new focus events and must never retry a failed request by themselves.
 * A successful empty catalog obeys the same TTL as a populated catalog.
 */
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

export function shouldRefreshProductsOnFocus(
  _warehouseId: number | null | undefined,
  isLoading: boolean,
  productCount = 0,
  lastSyncMs: number | null = null,
): boolean {
  if (isLoading) return false;
  // An authoritative empty result is still a completed fetch.
  if (productCount === 0 && !lastSyncMs) return true;
  // Caché poblada → solo refresca si la data ya está rancia
  if (lastSyncMs && Date.now() - lastSyncMs > MIN_REFRESH_INTERVAL_MS) return true;
  // Caché poblada y reciente → no hace nada (evita el loop)
  return false;
}

/** One attempt per focus, waiting for an existing fetch without retrying itself. */
export function startFocusedProductRefresh(input: {
  getState: () => { isLoading: boolean; productCount: number; lastSync: number | null; loadProducts: () => Promise<void> };
  subscribe: (listener: () => void) => () => void;
  isCurrent: () => boolean;
}): () => void {
  let finished = false;
  let unsubscribe = () => {};
  const attempt = () => {
    if (finished) return;
    if (!input.isCurrent()) { finished = true; unsubscribe(); return; }
    const current = input.getState();
    if (current.isLoading) return;
    // Unsubscribe before starting: loading/error updates from our own request
    // cannot schedule another request. Only a new focus/context can retry.
    finished = true;
    unsubscribe();
    if (shouldRefreshProductsOnFocus(null, false, current.productCount, current.lastSync)) {
      void current.loadProducts();
    }
  };
  unsubscribe = input.subscribe(attempt);
  attempt();
  return () => { finished = true; unsubscribe(); };
}
