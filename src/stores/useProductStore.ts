/**
 * Product store V2 — employee-scoped truck inventory + context cache.
 *
 * V2 CHANGES:
 * - qty_reserved: tracks local deductions from pending sales
 * - qty_display: available - reserved (what vendor sees)
 * - inventorySource records the employee REST source only
 * - restoreStock: explicit restore for rollback
 * - refreshInventory preserves qty_reserved from pending operations
 *
 * NON-NEGOTIABLE: Rollback never leaves stock corrupted.
 */

import { create } from 'zustand';
import { Product } from '../types/product';
import { storeSave, storeLoad, storeRemove, STORAGE_KEYS } from '../persistence/storage';
import { fetchTruckStock } from '../services/gfLogistics';
import { logInfo, logWarn } from '../utils/logger';
import { useAuthStore } from './useAuthStore';
import { useRouteStore } from './useRouteStore';
import {
  buildCacheEnvelope,
  readCacheEnvelope,
  buildContextKey,
} from '../services/persistentCache';
import { todayLocalISO } from '../utils/localDate';
import { schedulePersistPriceCache } from '../services/offlineCache';
import type { InventoryLoadResult } from '../services/legacyRefreshRunner';

export type InventorySource = 'truck_stock';

export interface TruckProduct extends Product {
  _totalKg: number;         // qty_available * weight
  qty_reserved: number;     // V2: pending deductions (positive = amount reserved)
  qty_display: number;      // V2: qty_available - qty_reserved
  _isGlobalFallback: false;
}

interface ProductState {
  products: TruckProduct[];
  isLoading: boolean;
  error: string | null;
  lastSync: number | null;
  inventorySource: InventorySource | null;
  /** warehouseId informado por el servidor en la ÚLTIMA carga exitosa. */
  loadedWarehouseId: number | null;
  /** plan_id de la respuesta de camioneta actualmente cargada. */
  loadedPlanId: number | null;
  /** Sin plan nunca se consulta truck_stock: la UI lo expresa sin fingir cero. */
  inventoryContext: 'ready' | 'plan_unavailable';
  /**
   * BLD-20260424-STOCKMETA: viene del flag `has_stock_data` que Sebastián
   * agregó al endpoint /truck_stock. true = el almacén tiene stock real
   * sincronizado; false = el catálogo existe pero sin stock (situación
   * normal cuando aún no se procesa el llenado del camión). Reemplaza la
   * heurística client-side anterior ("todos los qty en 0 → asumir sin
   * stock"). El contrato employee exige este flag; un sobre incompleto se
   * rechaza antes de mutar el catálogo contextual.
   *
   * null cuando no se ha hecho carga aún.
   */
  hasStockData: boolean | null;

  // Perf Fase 2B: metadata de caché persistente (para debug/UI mínima en 2C).
  // fromCache = los productos actuales provienen del caché de jornada (no de la
  // red). cachedAtMs = cuándo se generó el caché rehidratado.
  fromCache: boolean;
  cachedAtMs: number | null;

  // Derived
  totalStockKg: number;
  productCount: number;

  // Actions
  /** @deprecated warehouseId is ignored; truck stock is scoped by the active plan. */
  loadProducts: (_legacyWarehouseId?: number | null) => Promise<void>;
  /**
   * Carga de inventario con RESULTADO AUTORITATIVO explícito (P1-2). Envuelve
   * loadProducts y devuelve si la carga fue autoritativa según el endpoint
   * scoped por plan (sin error de red). El consumidor
   * NO debe inferir éxito por Promise resuelta ni por `error === null`.
   */
  loadProductsAuthoritative: (_legacyWarehouseId?: number | null) => Promise<InventoryLoadResult>;
  updateLocalStock: (productId: number, qtyChange: number) => void;
  /**
   * POST-R1A: apply ledger sellable projection without a second delta pass.
   * For each product id present in the map, sets qty_display to projected
   * sellable and derives qty_reserved from qty_available.
   * Ids omitted from the map are left unchanged.
   */
  applySellableProjection: (sellableByProductId: Record<number, number>) => void;
  getProduct: (productId: number) => TruckProduct | undefined;
  /**
   * Perf Fase 2B: rehidrata el catálogo desde el caché persistente de jornada
   * si el contexto coincide (mismo día/empleado/empresa/almacén) y no venció.
   * Devuelve el número de productos restaurados (0 si miss/stale/corrupto).
   * NO hace red; la carga online sigue siendo `loadProducts`.
   */
  hydrateFromCache: (warehouseId: number | null) => Promise<number>;
  reset: () => void;
}

// Weight fallback table (preserved from V1)
const WEIGHT_FALLBACK: Record<string, number> = {
  '5 kg': 5, '5kg': 5,
  '10 kg': 10, '10kg': 10,
  '15 kg': 15, '15kg': 15,
  '20 kg': 20, '20kg': 20,
  '25 kg': 25, '25kg': 25,
  '50 kg': 50, '50kg': 50,
  '75 kg': 75, '75kg': 75,
  'cup': 0.3, 'CUP': 0.3,
  'miche': 0.3, 'MICHE': 0.3,
  'juice': 0.3, 'JUICE': 0.3,
  'frappe': 1, 'FRAPPE': 1, 'frappé': 1,
};

function estimateWeight(name: string, existingWeight: number | undefined): number {
  if (existingWeight && existingWeight > 0) return existingWeight;
  const lowerName = name.toLowerCase();
  for (const [key, weight] of Object.entries(WEIGHT_FALLBACK)) {
    if (lowerName.includes(key.toLowerCase())) return weight;
  }
  return 1; // Default 1 kg
}

// ── Perf Fase 2B: catálogo persistente de jornada ───────────────────────────
// TTL holgado del sobre (cubre jornada larga); la invalidación primaria es la
// contextKey (día/empleado/empresa/almacén). El stock cacheado es REFERENCIAL:
// el backend valida al confirmar la venta. No habilita venta offline.
const CATALOG_CACHE_TTL_MS = 14 * 60 * 60 * 1000;

interface CatalogCachePayload {
  products: TruckProduct[];
  inventorySource: InventorySource | null;
  hasStockData: boolean | null;
}

/** contextKey de catálogo: día + empleado + empresa + almacén. */
function buildCatalogContextKey(planId: number | null): string {
  const auth = useAuthStore.getState();
  return buildContextKey([todayLocalISO(), auth.employeeId, auth.companyId, planId]);
}

/** Persiste el catálogo actual en disco (fire-and-forget). */
function persistCatalogToDisk(
  products: TruckProduct[],
  inventorySource: InventorySource | null,
  hasStockData: boolean | null,
  planId: number | null,
): void {
  if (products.length === 0) return;
  const payload: CatalogCachePayload = { products, inventorySource, hasStockData };
  const envelope = buildCacheEnvelope(payload, buildCatalogContextKey(planId), Date.now());
  void storeSave(STORAGE_KEYS.PRODUCTS_CATALOG, envelope);
}

export const useProductStore = create<ProductState>((set, get) => ({
  products: [],
  isLoading: false,
  error: null,
  lastSync: null,
  inventorySource: null,
  loadedWarehouseId: null,
  loadedPlanId: null,
  inventoryContext: 'ready',
  hasStockData: null,
  fromCache: false,
  cachedAtMs: null,
  totalStockKg: 0,
  productCount: 0,

  loadProducts: async (_legacyWarehouseId?: number | null) => {
    const planId = useRouteStore.getState().plan?.plan_id;
    if (!planId || planId <= 0) {
      logWarn('inventory', 'load_skipped_no_plan', {
        message: 'Cannot load inventory without an active route plan',
      });
      set({ error: null, isLoading: false, inventoryContext: 'plan_unavailable' });
      return;
    }

    set({ isLoading: true, error: null });

    // Preserve current reserved amounts (for refresh during active operations)
    const prevReserved = new Map<number, number>();
    for (const p of get().products) {
      if (p.qty_reserved > 0) {
        prevReserved.set(p.id, p.qty_reserved);
      }
    }

    try {
      // INV-1B: reconcile ambiguous ops BEFORE fetching truck_stock so the
      // snapshot is taken at-or-after any new server acknowledgements.
      try {
        const { useSyncStore } = await import('./useSyncStore.ts');
        const { reconcileAmbiguousLedgerOpsAgainstStore } = await import(
          '../services/ambiguousAckReconcileRuntime.ts'
        );
        const sync = useSyncStore.getState();
        // Awaits durable ACK RMW (serialized) before truck_stock. Persist
        // failure rejects → catch below → keep-set treats op as unacked.
        await reconcileAmbiguousLedgerOpsAgainstStore({
          queue: sync.queue as never,
          applyAcknowledgementsDurably: (intents) =>
            useSyncStore.getState().applyServerAcknowledgementsDurably(intents),
        });
      } catch (reconcileErr) {
        logWarn('inventory', 'ambiguous_ack_reconcile_failed', {
          error: reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr),
        });
      }

      const snapshotAtMs = Date.now();
      const scoped = await fetchTruckStock(planId);
      const rawProducts = scoped.products as Product[];
      const source: InventorySource = 'truck_stock';
      const hasStockData = scoped.hasStockData;
      logInfo('inventory', scoped.hasStockData === false ? 'loaded_truck_stock_reference' : 'loaded_truck_stock', {
        planId,
        warehouseId: scoped.warehouseId,
        locationId: scoped.locationId,
        inventorySource: scoped.inventorySource,
        count: rawProducts.length,
        hasStockData: scoped.hasStockData,
      });

      // Enrich the scoped response with local, display-only reservation state.
      const products: TruckProduct[] = rawProducts
        .filter((p) => p.sale_ok)
        .map((p) => {
          const weight = estimateWeight(p.name, p.weight);
          const reserved = prevReserved.get(p.id) || 0;
          // BLD-20260408-P0: Sanitize numeric fields — Odoo may return
          // null/false/undefined for list_price or qty_available.
          const safePrice = (typeof p.list_price === 'number' && !isNaN(p.list_price))
            ? p.list_price : 0;
          const safeQty = (typeof p.qty_available === 'number' && !isNaN(p.qty_available))
            ? p.qty_available : 0;
          return {
            ...p,
            list_price: safePrice,
            qty_available: safeQty,
            weight,
            _totalKg: safeQty * weight,
            qty_reserved: reserved,
            qty_display: Math.max(0, safeQty - reserved),
            _isGlobalFallback: false as false,
          };
        })
        .sort((a, b) => b.qty_available - a.qty_available);

      const totalKg = products.reduce((sum, p) => sum + p._totalKg, 0);

      set({
        products,
        isLoading: false,
        lastSync: Date.now(),
        totalStockKg: Math.round(totalKg),
        productCount: products.length,
        inventorySource: source,
        loadedWarehouseId: scoped.warehouseId,
        loadedPlanId: planId,
        hasStockData,
        inventoryContext: 'ready',
        // Carga fresca de red → ya no provienen del caché.
        fromCache: false,
        cachedAtMs: null,
      });

      // INV-1: rebase ledger against authoritative truck_stock, then re-project
      // sellable (pending local ops kept; synced ops dropped to avoid double-apply).
      try {
        const { rebaseAfterTruckStockRefresh } = await import('../services/inventoryLedger.ts');
        await rebaseAfterTruckStockRefresh(products, snapshotAtMs);
      } catch (ledgerErr) {
        logWarn('inventory', 'ledger_rebase_after_truck_stock_failed', {
          error: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
        });
      }

      // BLD-20260424-BUGA: resumen estructurado de la carga para poder
      // diagnosticar en campo sin rebuild. Útil cuando el operador reporta
      // "no salen productos" — con esta línea sabemos inmediatamente si
      // falló la descarga, si llegó pero con 0 stock, o si hubo fallback.
      const withStock = products.filter((p) => p.qty_available > 0).length;
      logInfo('inventory', 'load_summary', {
        source,
        hasStockData,
        count: products.length,
        withStock,
        totalKg: Math.round(totalKg),
        planId,
        warehouseId: scoped.warehouseId,
        locationId: scoped.locationId,
        inventorySource: scoped.inventorySource,
      });

      // Perf Fase 2B: persistir catálogo para sobrevivir reinicios en ruta.
      // Antes se BORRABA (storeRemove) para no vender contra stock viejo; ahora
      // se guarda como referencial — la venta sigue online-first y el backend
      // valida stock/precio al confirmar. Limpiamos la key legacy sin uso.
      void storeRemove(STORAGE_KEYS.PRODUCTS);
      persistCatalogToDisk(products, source, hasStockData, planId);
      schedulePersistPriceCache();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Error cargando productos';
      set({ error: msg, isLoading: false });
      logWarn('inventory', 'load_failed', { error: msg });
    }
  },

  // P1-2: solo la respuesta employee-scoped puede ser autoritativa. Un error
  // explícito conserva el catálogo contextual ya rehidratado, sin consultar
  // ninguna fuente alternativa.
  loadProductsAuthoritative: async (_legacyWarehouseId?: number | null): Promise<InventoryLoadResult> => {
    try {
      await get().loadProducts();
    } catch (e) {
      logWarn('inventory', 'authoritative_load_threw', {
        message: e instanceof Error ? e.message : String(e),
      });
      return { ok: false, authoritative: false, reason: 'network_error' };
    }
    const err = get().error;
    const source = get().inventorySource;
    const loadedWh = get().loadedWarehouseId;
    if (get().inventoryContext === 'plan_unavailable') {
      return { ok: false, authoritative: false, reason: 'plan_unavailable' };
    }
    if (err) {
      return { ok: false, authoritative: false, reason: 'network_error', source: source ?? undefined };
    }
    if (source === 'truck_stock' && typeof loadedWh === 'number' && loadedWh > 0) {
      return { ok: true, authoritative: true, warehouseId: loadedWh, source };
    }
    return { ok: false, authoritative: false, reason: 'unknown', source: source ?? undefined };
  },

  /**
   * V2: Update local stock after a sale or rollback.
   *
   * qtyChange semantics:
   *   NEGATIVE = deduct (sale confirmed, updateLocalStock(id, -qty))
   *   POSITIVE = restore (rollback or return, updateLocalStock(id, +qty))
   *
   * This updates qty_reserved and qty_display, NOT qty_available.
   * qty_available only changes on server refresh.
   */
  updateLocalStock: (productId, qtyChange) => {
    const products = get().products.map((p) => {
      if (p.id === productId) {
        // qtyChange < 0 means deduction → increase reserved
        // qtyChange > 0 means restore → decrease reserved
        const newReserved = Math.max(0, p.qty_reserved - qtyChange);
        const newDisplay = Math.max(0, p.qty_available - newReserved);
        return {
          ...p,
          qty_reserved: newReserved,
          qty_display: newDisplay,
          _totalKg: newDisplay * (p.weight || 1),
        };
      }
      return p;
    });
    const totalKg = products.reduce((sum, p) => sum + p._totalKg, 0);
    set({ products, totalStockKg: Math.round(totalKg) });
    // Perf Fase 2B: re-persistir el catálogo con las reservas locales para que
    // qty_reserved/qty_display sobrevivan un reinicio (display de lectura).
    persistCatalogToDisk(
      products,
      get().inventorySource,
      get().hasStockData,
      useRouteStore.getState().plan?.plan_id ?? null,
    );
  },

  applySellableProjection: (sellableByProductId) => {
    const products = get().products.map((p) => {
      if (!Object.prototype.hasOwnProperty.call(sellableByProductId, p.id)) return p;
      const sellable = sellableByProductId[p.id];
      // Exact projection — allow negative sellable (deficit). Never coerce to 0.
      if (typeof sellable !== 'number' || !Number.isFinite(sellable)) return p;
      const newDisplay = sellable;
      const newReserved = Number.isFinite(p.qty_available)
        ? Math.max(0, p.qty_available - Math.min(newDisplay, p.qty_available))
        : 0;
      return {
        ...p,
        qty_reserved: newReserved,
        qty_display: newDisplay,
        _totalKg: newDisplay * (p.weight || 1),
      };
    });
    const totalKg = products.reduce((sum, p) => sum + p._totalKg, 0);
    set({ products, totalStockKg: Math.round(totalKg) });
    persistCatalogToDisk(
      products,
      get().inventorySource,
      get().hasStockData,
      useRouteStore.getState().plan?.plan_id ?? null,
    );
  },

  getProduct: (productId) => get().products.find((p) => p.id === productId),

  hydrateFromCache: async (planId: number | null) => {
    try {
      const raw = await storeLoad<unknown>(STORAGE_KEYS.PRODUCTS_CATALOG);
      if (raw === null) return 0;
      const result = readCacheEnvelope<CatalogCachePayload>(
        raw,
        buildCatalogContextKey(planId),
        CATALOG_CACHE_TTL_MS,
        Date.now(),
      );
      if (result.status !== 'ok' || !result.payload || !Array.isArray(result.payload.products)) {
        // miss (otro día/empleado/almacén/corrupto) o stale → limpiar, no hidratar.
        await storeRemove(STORAGE_KEYS.PRODUCTS_CATALOG);
        if (result.status === 'stale') {
          logInfo('inventory', 'catalog_cache_stale_cleared', {});
        }
        return 0;
      }
      const products = result.payload.products;
      const totalKg = products.reduce((sum, p) => sum + (p._totalKg || 0), 0);
      set({
        products,
        inventorySource: result.payload.inventorySource ?? 'truck_stock',
        hasStockData: result.payload.hasStockData ?? null,
        totalStockKg: Math.round(totalKg),
        productCount: products.length,
        lastSync: result.cachedAtMs,
        fromCache: true,
        cachedAtMs: result.cachedAtMs,
      });
      logInfo('inventory', 'catalog_cache_hydrated', {
        count: products.length,
        cachedAtMs: result.cachedAtMs,
      });
      return products.length;
    } catch (error) {
      logWarn('inventory', 'catalog_cache_hydrate_failed', { error: String(error) });
      try { await storeRemove(STORAGE_KEYS.PRODUCTS_CATALOG); } catch { /* noop */ }
      return 0;
    }
  },

  reset: () => set({
    products: [], isLoading: false, error: null,
    lastSync: null, totalStockKg: 0, productCount: 0,
    inventorySource: null, loadedWarehouseId: null, loadedPlanId: null,
    hasStockData: null, inventoryContext: 'ready',
    fromCache: false, cachedAtMs: null,
  }),
}));
