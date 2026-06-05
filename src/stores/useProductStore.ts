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
import { Product } from '../types/product';
import { odooRead } from '../services/odooRpc';
import { storeRemove, STORAGE_KEYS } from '../persistence/storage';
import { fetchTruckStock } from '../services/gfLogistics';
import { logInfo, logWarn } from '../utils/logger';
import { useAuthStore } from './useAuthStore';

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

  // Derived
  totalStockKg: number;
  productCount: number;

  // Actions
  loadProducts: (warehouseId: number) => Promise<void>;
  updateLocalStock: (productId: number, qtyChange: number) => void;
  getProduct: (productId: number) => TruckProduct | undefined;
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

export const useProductStore = create<ProductState>((set, get) => ({
  products: [],
  isLoading: false,
  error: null,
  lastSync: null,
  inventorySource: null,
  hasStockData: null,
  totalStockKg: 0,
  productCount: 0,

  loadProducts: async (warehouseId: number) => {
    // BLD-20260408-P0: Guard against null/0 warehouseId — this was the root
    // cause of inventory loading the global product list (104 products,
    // 595k kg) instead of the truck's scoped stock.
    if (!warehouseId || warehouseId <= 0) {
      logWarn('inventory', 'load_skipped_no_warehouse', {
        warehouseId,
        message: 'Cannot load inventory without a valid warehouseId',
      });
      set({ error: 'Sin almacén asignado. Cierra sesión e inicia de nuevo.', isLoading: false });
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

      set({
        products,
        isLoading: false,
        lastSync: Date.now(),
        totalStockKg: Math.round(totalKg),
        productCount: products.length,
        inventorySource: source,
        hasStockData,
      });

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

      void storeRemove(STORAGE_KEYS.PRODUCTS);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Error cargando productos';
      set({ error: msg, isLoading: false });
      logWarn('inventory', 'load_failed', { error: msg });
    }
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
    void storeRemove(STORAGE_KEYS.PRODUCTS);
  },

  getProduct: (productId) => get().products.find((p) => p.id === productId),

  reset: () => set({
    products: [], isLoading: false, error: null,
    lastSync: null, totalStockKg: 0, productCount: 0,
    inventorySource: null, hasStockData: null,
  }),
}));
