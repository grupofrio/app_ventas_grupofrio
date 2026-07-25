/**
 * Product store V2 — truck inventory + product catalog.
 *
 * V2 CHANGES:
 * - qty_reserved: tracks local deductions from pending sales
 * - qty_display: available - reserved (what vendor sees)
 * - _isGlobalFallback: flag when loaded from legacy global path
 * - inventorySource: tracks which fallback level loaded the data
 * - 3-level fallback chain when truck_stock has no catalog: stock.quant → global_legacy
 * - restoreStock: explicit restore for rollback
 * - refreshInventory preserves qty_reserved from pending operations
 *
 * NON-NEGOTIABLE: Rollback never leaves stock corrupted.
 */

import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { Product } from '../types/product';
import { odooRead } from '../services/odooRpc';
import { storeSave, storeLoad, storeRemove, STORAGE_KEYS } from '../persistence/storage';
import { fetchTruckStock } from '../services/gfLogistics';
import { logInfo, logWarn } from '../utils/logger';
import { useAuthStore } from './useAuthStore';
import {
  buildCacheEnvelope,
  readCacheEnvelope,
  buildContextKey,
} from '../services/persistentCache';
import { todayLocalISO } from '../utils/localDate';
import { schedulePersistPriceCache } from '../services/offlineCache';
import type { InventoryLoadResult } from '../services/legacyRefreshRunner';
import type { SaleLineItem } from './useVisitStore';
import type { InventoryFreshness } from '../services/effectiveOfflineCatalog';
import {
  buildOfflineCatalogContext,
  buildOfflineCatalogContextIdentity,
  loadLastKnownCatalog,
  loadRecentProducts,
  saveLastKnownCatalogStrict,
  saveRecentProductsStrict,
  type LastKnownCatalogSnapshot,
  type OfflineCatalogContext,
} from '../services/offlineCatalogRepository';
import {
  upsertRecentProducts,
  type RecentProductSnapshot,
} from '../services/recentProductIndex';
import { describeInventoryAuthority } from '../services/productInventoryFreshness';

export type InventorySource = 'truck_stock' | 'stock_quant' | 'global_legacy';

export interface TruckProduct extends Product {
  _totalKg: number;         // qty_available * weight
  qty_reserved: number;     // V2: pending deductions (positive = amount reserved)
  qty_display: number;      // V2: qty_available - qty_reserved
  _isGlobalFallback: boolean; // V2: true if from legacy path
}

interface ProductState {
  products: TruckProduct[];
  isLoading: boolean;
  error: string | null;
  lastSync: number | null;
  inventorySource: InventorySource | null;
  /** warehouseId al que corresponde la ÚLTIMA carga exitosa (para verificar que
   * un refresh es autoritativo para el almacén esperado). null si no hay carga. */
  loadedWarehouseId: number | null;
  /**
   * BLD-20260424-STOCKMETA: viene del flag `has_stock_data` que Sebastián
   * agregó al endpoint /truck_stock. true = el almacén tiene stock real
   * sincronizado; false = el catálogo existe pero sin stock (situación
   * normal cuando aún no se procesa el llenado del camión). Reemplaza la
   * heurística client-side anterior ("todos los qty en 0 → asumir sin
   * stock"). Si el backend no manda el flag (compat), por defecto true.
   *
   * null cuando no se ha hecho carga aún o cuando el source no es
   * truck_stock (stock_quant y global_legacy no tienen este flag).
   */
  hasStockData: boolean | null;

  // Perf Fase 2B: metadata de caché persistente (para debug/UI mínima en 2C).
  // fromCache = los productos actuales provienen del caché de jornada (no de la
  // red). cachedAtMs = cuándo se generó el caché rehidratado.
  fromCache: boolean;
  cachedAtMs: number | null;
  inventoryFreshness: InventoryFreshness;
  recentProducts: RecentProductSnapshot[];

  // Derived
  totalStockKg: number;
  productCount: number;

  // Actions
  loadProducts: (warehouseId: number) => Promise<void>;
  /**
   * Carga de inventario con RESULTADO AUTORITATIVO explícito (P1-2). Envuelve
   * loadProducts y devuelve si la carga fue autoritativa para el warehouse
   * esperado (fuente scoped, no `global_legacy`, sin error de red). El consumidor
   * NO debe inferir éxito por Promise resuelta ni por `error === null`.
   */
  loadProductsAuthoritative: (warehouseId: number) => Promise<InventoryLoadResult>;
  updateLocalStock: (productId: number, qtyChange: number) => void;
  getProduct: (productId: number) => TruckProduct | undefined;
  /**
   * Perf Fase 2B: rehidrata el catálogo desde el caché persistente de jornada
   * si el contexto coincide (mismo día/empleado/empresa/almacén) y no venció.
   * Devuelve el número de productos restaurados (0 si miss/stale/corrupto).
   * NO hace red; la carga online sigue siendo `loadProducts`.
   */
  hydrateFromCache: (warehouseId: number | null) => Promise<number>;
  hydrateOfflineCatalog: (warehouseId: number | null) => Promise<number>;
  recordRecentProducts: (lines: SaleLineItem[]) => Promise<void>;
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

const PRODUCT_FIELDS = [
  'id', 'name', 'default_code', 'list_price', 'qty_available',
  'sale_ok', 'product_tmpl_id', 'weight', 'categ_id',
  // BLD-20260409: removed image_128 — Odoo doesn't return binary fields
  // via search_read/get_records. Images loaded via URL in ProductPicker.
];

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

let catalogGeneration = 0;
let recentWriteChain: Promise<void> = Promise.resolve();
let activeCatalogContextIdentity: string | null = null;

function positiveSafeId(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0;
}

function validOfflineCatalogContext(
  context: OfflineCatalogContext,
): context is OfflineCatalogContext & {
  employeeId: number;
  companyId: number;
  warehouseId: number;
} {
  return positiveSafeId(context.employeeId)
    && positiveSafeId(context.companyId)
    && positiveSafeId(context.warehouseId)
    && (context.mobileLocationId === null || positiveSafeId(context.mobileLocationId));
}

function currentOfflineCatalogContext(
  warehouseId: number | null,
): (OfflineCatalogContext & {
  employeeId: number;
  companyId: number;
  warehouseId: number;
}) | null {
  const auth = useAuthStore.getState();
  if (!positiveSafeId(warehouseId) || auth.warehouseId !== warehouseId) return null;
  const context = buildOfflineCatalogContext({
    employeeId: auth.employeeId,
    companyId: auth.companyId,
    warehouseId,
    mobileLocationId: auth.mobileLocationId,
  });
  return validOfflineCatalogContext(context) ? context : null;
}

/** contextKey de catálogo: día + contexto completo de auth/logística. */
function buildCatalogContextKey(context: OfflineCatalogContext): string {
  return buildContextKey([
    todayLocalISO(),
    context.employeeId,
    context.companyId,
    context.warehouseId,
    context.mobileLocationId,
  ]);
}

/** Persiste el catálogo actual de jornada sin convertirlo en autoridad. */
async function persistCatalogToDisk(
  products: TruckProduct[],
  inventorySource: InventorySource | null,
  hasStockData: boolean | null,
  context: OfflineCatalogContext,
  fetchedAtMs = Date.now(),
): Promise<void> {
  if (products.length === 0) return;
  const payload: CatalogCachePayload = { products, inventorySource, hasStockData };
  const envelope = buildCacheEnvelope(payload, buildCatalogContextKey(context), fetchedAtMs);
  await storeSave(STORAGE_KEYS.PRODUCTS_CATALOG, envelope);
}

function safeInventorySource(value: unknown): InventorySource | null {
  return value === 'truck_stock'
    || value === 'stock_quant'
    || value === 'global_legacy'
    ? value
    : null;
}

function validCachedProduct(value: unknown): value is TruckProduct {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const product = value as Partial<TruckProduct>;
  return positiveSafeId(product.id)
    && typeof product.name === 'string'
    && product.name.trim().length > 0
    && typeof product.list_price === 'number'
    && Number.isFinite(product.list_price)
    && product.list_price >= 0
    && typeof product.qty_available === 'number'
    && Number.isFinite(product.qty_available)
    && typeof product.sale_ok === 'boolean'
    && typeof product._totalKg === 'number'
    && Number.isFinite(product._totalKg)
    && typeof product.qty_reserved === 'number'
    && Number.isFinite(product.qty_reserved)
    && product.qty_reserved >= 0
    && typeof product.qty_display === 'number'
    && Number.isFinite(product.qty_display)
    && product.qty_display >= 0
    && typeof product._isGlobalFallback === 'boolean';
}

function parseCatalogCachePayload(value: unknown): CatalogCachePayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Partial<CatalogCachePayload>;
  if (
    !Array.isArray(payload.products)
    || payload.products.length === 0
    || !payload.products.every(validCachedProduct)
    || !(
      payload.inventorySource === null
      || payload.inventorySource === 'truck_stock'
      || payload.inventorySource === 'stock_quant'
      || payload.inventorySource === 'global_legacy'
    )
    || !(
      payload.hasStockData === null
      || typeof payload.hasStockData === 'boolean'
    )
  ) {
    return null;
  }
  const ids = new Set(payload.products.map(({ id }) => id));
  if (ids.size !== payload.products.length) return null;
  return {
    products: payload.products.map((product) => ({ ...product })),
    inventorySource: safeInventorySource(payload.inventorySource),
    hasStockData: payload.hasStockData,
  };
}

async function currentNetworkStatus(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === true && state.isInternetReachable !== false;
  } catch {
    return false;
  }
}

export const useProductStore = create<ProductState>((set, get) => ({
  products: [],
  isLoading: false,
  error: null,
  lastSync: null,
  inventorySource: null,
  loadedWarehouseId: null,
  hasStockData: null,
  fromCache: false,
  cachedAtMs: null,
  inventoryFreshness: 'unknown',
  recentProducts: [],
  totalStockKg: 0,
  productCount: 0,

  loadProducts: async (warehouseId: number) => {
    // BLD-20260408-P0: Guard against null/0 warehouseId — this was the root
    // cause of inventory loading the global product list (104 products,
    // 595k kg) instead of the truck's scoped stock.
    if (!positiveSafeId(warehouseId)) {
      logWarn('inventory', 'load_skipped_no_warehouse', {
        warehouseId,
        message: 'Cannot load inventory without a valid warehouseId',
      });
      set({ error: 'Sin almacén asignado. Cierra sesión e inicia de nuevo.', isLoading: false });
      return;
    }

    const context = currentOfflineCatalogContext(warehouseId);
    if (!context) {
      catalogGeneration += 1;
      activeCatalogContextIdentity = null;
      set({
        products: [],
        recentProducts: [],
        error: 'La sesión no tiene un contexto logístico válido.',
        isLoading: false,
        lastSync: null,
        totalStockKg: 0,
        productCount: 0,
        inventorySource: null,
        loadedWarehouseId: null,
        hasStockData: null,
        fromCache: false,
        cachedAtMs: null,
        inventoryFreshness: 'unknown',
      });
      return;
    }
    const contextIdentity = buildOfflineCatalogContextIdentity(context);
    const loadGeneration = ++catalogGeneration;
    if (
      activeCatalogContextIdentity !== null
      && activeCatalogContextIdentity !== contextIdentity
    ) {
      set({
        products: [],
        recentProducts: [],
        lastSync: null,
        totalStockKg: 0,
        productCount: 0,
        inventorySource: null,
        loadedWarehouseId: null,
        hasStockData: null,
        fromCache: false,
        cachedAtMs: null,
        inventoryFreshness: 'unknown',
      });
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
      let rawProducts: Product[] | null = null;
      let source: InventorySource = 'global_legacy';
      // BLD-20260424-STOCKMETA: hasStockData arranca null (sin info).
      // Lo poblamos solo cuando truck_stock contesta — los otros niveles
      // de fallback (stock_quant, global) no exponen esta señal.
      let hasStockData: boolean | null = null;

      // ── LEVEL 1: truck_stock endpoint (BLD-013) ──
      // BLD-20260424-STOCKMETA: la decisión "este catálogo no tiene stock
      // sincronizado en el almacén" ahora la determina el backend vía el
      // flag `has_stock_data` (commit dd78489 de Sebastián). El cliente
      // solo lo lee y lo expone al store; ProductPicker decide la UI.
      // Keep the endpoint input visibly sourced from the current auth session;
      // `context` captured the same value synchronously and guards stale writes.
      const mobileLocationId = useAuthStore.getState().mobileLocationId;
      const scoped = await fetchTruckStock(warehouseId, mobileLocationId);
      if (scoped && scoped.products.length > 0) {
        rawProducts = scoped.products as Product[];
        source = 'truck_stock';
        hasStockData = scoped.hasStockData;
        logInfo('inventory', scoped.hasStockData === false ? 'loaded_truck_stock_reference' : 'loaded_truck_stock', {
          warehouse: warehouseId,
          mobileLocationId,
          count: rawProducts.length,
          hasStockData: scoped.hasStockData,
        });
      } else if (scoped && scoped.products.length === 0) {
        logWarn('inventory', 'truck_stock_empty_fallback', {
          warehouse: warehouseId,
          mobileLocationId,
          count: 0,
          message:
            'truck_stock no devolvio productos; intentando stock.quant por ubicacion movil.',
        });
      }

      // ── LEVEL 2: stock.quant query by mobile location / warehouse ──
      if (!rawProducts) {
        try {
          const locationDomain = mobileLocationId && mobileLocationId > 0
            ? ['location_id', 'child_of', mobileLocationId]
            : ['location_id.warehouse_id', '=', warehouseId];
          const quants = await odooRead<any>('stock.quant', [
            locationDomain,
            ['quantity', '>', 0],
            ['product_id.sale_ok', '=', true],
            ['product_id.active', '=', true],
          ], ['product_id', 'quantity', 'reserved_quantity'], 500);

          if (quants && quants.length > 0) {
            // stock.quant returns product_id as [id, name] tuple
            // We need to load full product data for these products
            const productIds = quants.map((q: any) =>
              Array.isArray(q.product_id) ? q.product_id[0] : q.product_id
            );
            const products = await odooRead<Product>(
              'product.product',
              [['id', 'in', productIds]],
              PRODUCT_FIELDS,
              500
            );

            // Merge quant quantities into product data
            const quantMap = new Map<number, number>();
            for (const q of quants) {
              const pid = Array.isArray(q.product_id) ? q.product_id[0] : q.product_id;
              const available = (q.quantity || 0) - (q.reserved_quantity || 0);
              quantMap.set(pid, (quantMap.get(pid) || 0) + available);
            }

            rawProducts = products.map((p) => ({
              ...p,
              qty_available: quantMap.get(p.id) ?? p.qty_available,
            }));
            source = 'stock_quant';
            hasStockData = null;
            logInfo('inventory', 'loaded_stock_quant', {
              warehouse: warehouseId,
              mobileLocationId,
              count: rawProducts.length,
            });
          }
        } catch (e) {
          logWarn('inventory', 'stock_quant_fallback', {
            warehouse: warehouseId,
            mobileLocationId,
            error: String(e),
          });
        }
      }

      // ── LEVEL 3: Legacy global (NO warehouse filter) ──
      if (!rawProducts) {
        logWarn('inventory', 'global_fallback', {
          warehouse: warehouseId,
          message: 'Using global product list — no warehouse filter',
        });

        rawProducts = await odooRead<Product>(
          'product.product',
          [
            ['sale_ok', '=', true],
            ['type', '!=', 'service'],
            ['active', '=', true],
          ],
          PRODUCT_FIELDS,
          200
        );
        source = 'global_legacy';
      }

      // Enrich with weight + V2 fields
      const isGlobal = source === 'global_legacy';
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
            _isGlobalFallback: isGlobal,
          };
        })
        .sort((a, b) => b.qty_available - a.qty_available);

      const totalKg = products.reduce((sum, p) => sum + p._totalKg, 0);
      const isOnline = await currentNetworkStatus();
      const currentContext = currentOfflineCatalogContext(warehouseId);
      if (
        loadGeneration !== catalogGeneration
        || !currentContext
        || buildOfflineCatalogContextIdentity(currentContext) !== contextIdentity
      ) {
        return;
      }
      const fetchedAtMs = Date.now();
      const inventoryFreshness = describeInventoryAuthority({
        isOnline,
        loadedWarehouseId: warehouseId,
        expectedWarehouseId: currentContext.warehouseId,
        inventorySource: source,
        fromCache: false,
      });

      set({
        products,
        isLoading: false,
        lastSync: fetchedAtMs,
        totalStockKg: Math.round(totalKg),
        productCount: products.length,
        inventorySource: source,
        loadedWarehouseId: warehouseId,
        hasStockData,
        // Carga fresca de red → ya no provienen del caché.
        fromCache: false,
        cachedAtMs: null,
        inventoryFreshness,
      });
      activeCatalogContextIdentity = contextIdentity;

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
        warehouseId,
        mobileLocationId,
      });

      // Perf Fase 2B: persistir catálogo para sobrevivir reinicios en ruta.
      // Antes se BORRABA (storeRemove) para no vender contra stock viejo; ahora
      // se guarda como referencial — la venta sigue online-first y el backend
      // valida stock/precio al confirmar. Limpiamos la key legacy sin uso.
      void storeRemove(STORAGE_KEYS.PRODUCTS);
      if (products.length > 0) {
        await persistCatalogToDisk(
          products,
          source,
          hasStockData,
          context,
          fetchedAtMs,
        );
        try {
          await saveLastKnownCatalogStrict({
            version: 1,
            companyId: context.companyId,
            employeeId: context.employeeId,
            warehouseId: context.warehouseId,
            mobileLocationId: context.mobileLocationId,
            fetchedAtMs,
            inventorySource: source,
            hasStockData,
            products: products.map((product) => ({ ...product })),
          } satisfies LastKnownCatalogSnapshot);
        } catch (error) {
          logWarn('inventory', 'last_known_catalog_save_failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      schedulePersistPriceCache();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Error cargando productos';
      const currentContext = currentOfflineCatalogContext(warehouseId);
      if (
        loadGeneration === catalogGeneration
        && currentContext
        && buildOfflineCatalogContextIdentity(currentContext) === contextIdentity
      ) {
        set({ error: msg, isLoading: false });
      }
      logWarn('inventory', 'load_failed', { error: msg });
    }
  },

  // P1-2: carga con resultado AUTORITATIVO explícito. loadProducts absorbe sus
  // errores (setea `error`, resuelve) y puede terminar en `global_legacy` (lista
  // global sin scope de almacén). Aquí NO inferimos éxito por Promise/error null:
  // exigimos la misma autoridad estricta expuesta a la UI: truck_stock fresco,
  // online, sin caché y para el warehouse solicitado.
  loadProductsAuthoritative: async (warehouseId: number): Promise<InventoryLoadResult> => {
    if (!warehouseId || warehouseId <= 0) {
      return { ok: false, authoritative: false, reason: 'missing_warehouse' };
    }
    try {
      await get().loadProducts(warehouseId);
    } catch (e) {
      logWarn('inventory', 'authoritative_load_threw', {
        message: e instanceof Error ? e.message : String(e),
      });
      return { ok: false, authoritative: false, reason: 'network_error' };
    }
    const err = get().error;
    const source = get().inventorySource;
    const loadedWh = get().loadedWarehouseId;
    const inventoryFreshness = get().inventoryFreshness;
    if (err) {
      return { ok: false, authoritative: false, reason: 'network_error', source: source ?? undefined };
    }
    if (source === 'global_legacy') {
      return { ok: false, authoritative: false, reason: 'global_legacy_fallback', source };
    }
    if (loadedWh !== warehouseId) {
      return { ok: false, authoritative: false, reason: 'warehouse_mismatch', source: source ?? undefined };
    }
    if (source === 'truck_stock' && inventoryFreshness === 'authoritative') {
      return { ok: true, authoritative: true, warehouseId, source };
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
    const context = currentOfflineCatalogContext(get().loadedWarehouseId);
    if (
      context
      && buildOfflineCatalogContextIdentity(context) === activeCatalogContextIdentity
    ) {
      void persistCatalogToDisk(
        products,
        get().inventorySource,
        get().hasStockData,
        context,
      );
    }
  },

  getProduct: (productId) => get().products.find((p) => p.id === productId),

  hydrateFromCache: async (warehouseId: number | null) =>
    get().hydrateOfflineCatalog(warehouseId),

  hydrateOfflineCatalog: async (warehouseId: number | null) => {
    const hydrationGeneration = ++catalogGeneration;
    const context = currentOfflineCatalogContext(warehouseId);
    if (!context) {
      activeCatalogContextIdentity = null;
      set({
        products: [],
        recentProducts: [],
        isLoading: false,
        error: null,
        lastSync: null,
        totalStockKg: 0,
        productCount: 0,
        inventorySource: null,
        loadedWarehouseId: null,
        hasStockData: null,
        fromCache: false,
        cachedAtMs: null,
        inventoryFreshness: 'unknown',
      });
      return 0;
    }
    const contextIdentity = buildOfflineCatalogContextIdentity(context);

    let sameDayPayload: CatalogCachePayload | null = null;
    let sameDayCachedAtMs: number | null = null;
    try {
      const raw = await storeLoad<unknown>(STORAGE_KEYS.PRODUCTS_CATALOG);
      if (raw !== null) {
        const result = readCacheEnvelope<unknown>(
          raw,
          buildCatalogContextKey(context),
          CATALOG_CACHE_TTL_MS,
          Date.now(),
        );
        if (result.status === 'ok') {
          sameDayPayload = parseCatalogCachePayload(result.payload);
          sameDayCachedAtMs = sameDayPayload ? result.cachedAtMs : null;
        }
        if (result.status !== 'ok' || !sameDayPayload) {
          await storeRemove(STORAGE_KEYS.PRODUCTS_CATALOG);
          if (result.status === 'stale') {
            logInfo('inventory', 'catalog_cache_stale_cleared', {});
          }
        }
      }
    } catch (error) {
      logWarn('inventory', 'catalog_cache_hydrate_failed', { error: String(error) });
      try { await storeRemove(STORAGE_KEYS.PRODUCTS_CATALOG); } catch { /* noop */ }
    }

    const lastKnown = sameDayPayload
      ? null
      : await loadLastKnownCatalog(context);
    const recentProducts = await loadRecentProducts(context);
    const currentContext = currentOfflineCatalogContext(warehouseId);
    if (
      hydrationGeneration !== catalogGeneration
      || !currentContext
      || buildOfflineCatalogContextIdentity(currentContext) !== contextIdentity
    ) {
      return 0;
    }

    const products = sameDayPayload?.products
      ?? lastKnown?.products.map((product) => ({ ...product }))
      ?? [];
    const inventorySource = sameDayPayload?.inventorySource
      ?? lastKnown?.inventorySource
      ?? null;
    const hasStockData = sameDayPayload?.hasStockData
      ?? lastKnown?.hasStockData
      ?? null;
    const cachedAtMs = sameDayCachedAtMs ?? lastKnown?.fetchedAtMs ?? null;
    const totalKg = products.reduce((sum, product) => sum + product._totalKg, 0);
    const hasCatalog = products.length > 0;

    set({
      products,
      recentProducts: recentProducts.map((product) => ({ ...product })),
      isLoading: false,
      error: null,
      inventorySource,
      loadedWarehouseId: hasCatalog ? context.warehouseId : null,
      hasStockData,
      totalStockKg: Math.round(totalKg),
      productCount: products.length,
      lastSync: cachedAtMs,
      fromCache: hasCatalog,
      cachedAtMs,
      inventoryFreshness: hasCatalog ? 'cached' : 'unknown',
    });
    activeCatalogContextIdentity = contextIdentity;
    logInfo('inventory', 'offline_catalog_hydrated', {
      count: products.length,
      recentCount: recentProducts.length,
      source: sameDayPayload ? 'same_day' : lastKnown ? 'last_known' : 'none',
      cachedAtMs,
    });
    return products.length;
  },

  recordRecentProducts: async (lines: SaleLineItem[]) => {
    const authWarehouseId = useAuthStore.getState().warehouseId;
    const context = currentOfflineCatalogContext(authWarehouseId);
    if (!context || !Array.isArray(lines)) return;
    const contextIdentity = buildOfflineCatalogContextIdentity(context);
    const recordGeneration = catalogGeneration;
    const productsById = new Map(
      get().products.map((product) => [product.id, product] as const),
    );
    const recentById = new Map(
      get().recentProducts.map((product) => [product.productId, product] as const),
    );
    const lastSeenAtMs = Date.now();
    const incoming: RecentProductSnapshot[] = [];

    for (const line of lines) {
      if (
        !line
        || !positiveSafeId(line.productId)
        || typeof line.productName !== 'string'
        || line.productName.trim().length === 0
        || typeof line.qty !== 'number'
        || !Number.isSafeInteger(line.qty)
        || line.qty <= 0
        || typeof line.weight !== 'number'
        || !Number.isFinite(line.weight)
        || line.weight < 0
      ) {
        continue;
      }
      const product = productsById.get(line.productId);
      const previous = recentById.get(line.productId);
      const publicListPrice = product?.list_price ?? previous?.listPrice ?? 0;
      if (!Number.isFinite(publicListPrice) || publicListPrice < 0) continue;
      const productName = product?.name?.trim() || previous?.name || line.productName.trim();
      const rawDefaultCode = product?.default_code;
      const defaultCode = typeof rawDefaultCode === 'string'
        ? rawDefaultCode.trim() || null
        : previous?.defaultCode ?? null;
      const publicWeight = typeof product?.weight === 'number'
        && Number.isFinite(product.weight)
        && product.weight >= 0
        ? product.weight
        : previous?.weight ?? line.weight;
      incoming.push({
        productId: line.productId,
        name: productName,
        defaultCode,
        listPrice: publicListPrice,
        weight: publicWeight,
        lastSeenAtMs,
      });
    }
    if (incoming.length === 0) return;

    const write = recentWriteChain.then(async () => {
      const persisted = await loadRecentProducts(context);
      const next = upsertRecentProducts(persisted, incoming);
      try {
        await saveRecentProductsStrict(context, next);
      } catch (error) {
        logWarn('inventory', 'recent_products_save_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      const currentContext = currentOfflineCatalogContext(authWarehouseId);
      if (
        recordGeneration !== catalogGeneration
        || !currentContext
        || buildOfflineCatalogContextIdentity(currentContext) !== contextIdentity
      ) {
        return;
      }
      set({ recentProducts: next.map((product) => ({ ...product })) });
    });
    recentWriteChain = write.catch(() => undefined);
    await write;
  },

  reset: () => {
    catalogGeneration += 1;
    activeCatalogContextIdentity = null;
    set({
      products: [], isLoading: false, error: null,
      lastSync: null, totalStockKg: 0, productCount: 0,
      inventorySource: null, loadedWarehouseId: null, hasStockData: null,
      fromCache: false, cachedAtMs: null,
      inventoryFreshness: 'unknown', recentProducts: [],
    });
  },
}));

// Product data is memory-scoped. Logging out or switching any auth/logistics
// identity immediately clears it; durable snapshots remain partitioned on disk.
useAuthStore.subscribe((state, previous) => {
  const currentIdentity = buildOfflineCatalogContextIdentity(
    buildOfflineCatalogContext(state),
  );
  const previousIdentity = buildOfflineCatalogContextIdentity(
    buildOfflineCatalogContext(previous),
  );
  if (currentIdentity !== previousIdentity) {
    useProductStore.getState().reset();
  }
});
