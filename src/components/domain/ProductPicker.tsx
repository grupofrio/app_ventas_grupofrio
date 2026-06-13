/**
 * ProductPicker V2.1 — Dual view product selector.
 *
 * BLD-20260409-FIX: Fixes from real device testing:
 * - Images: URL-based (/web/image/) instead of base64 (image_128 not returned by API)
 * - Toggle: Uses text labels instead of unicode symbols, key prop forces FlatList remount
 * - Prices: Supports customer-specific pricelist (not just public list_price)
 * - Prices: Displayed exactly as they come from the active pricelist
 *
 * PRICE LOGIC:
 *   1. Check customer pricelist (priceMap from pricelist.ts)
 *   2. If no custom price → use list_price (public)
 *   3. Display the same price shown in the pricelist
 *   4. SaleLineItem.price = that same price for Odoo sync
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Modal, Image, Dimensions, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProductStore, TruckProduct } from '../../stores/useProductStore';
import { useVisitStore, SaleLineItem } from '../../stores/useVisitStore';
import { useKoldStore } from '../../stores/useKoldStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { getBaseUrl } from '../../services/api';
import { clearPricelistCaches, computeCustomerPrices, peekCachedCustomerPrices } from '../../services/pricelist';
import { schedulePersistPriceCache } from '../../services/offlineCache';
import { CacheStatusBadge } from '../ui/CacheStatusBadge';
import { getVisiblePricelistPrice, normalizeSaleLineBasePrice } from '../../services/salePricing';
import { Badge } from '../ui/Badge';
import { colors, spacing, radii } from '../../theme/tokens';
import { typography, fonts } from '../../theme/typography';
import { formatCurrency } from '../../utils/time';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

// ═══ Types ═══

type ViewMode = 'list' | 'grid';

interface ProductPickerProps {
  visible: boolean;
  onClose: () => void;
  existingProductIds: number[];
  partnerId?: number;
  pricelistId?: number | null;
  /**
   * Optional sink for the selected line. When provided, the picker calls this
   * INSTEAD of writing to useVisitStore.saleLines — used by flows that keep
   * their own cart (e.g. Preventa) so they don't contaminate the active-visit
   * cart. When omitted, behavior is unchanged (writes to the visit store).
   */
  onAddLine?: (line: SaleLineItem) => void;
}

const CATEGORIES = [
  { key: 'all', label: 'Todos', icon: '📦' },
  { key: 'hielo', label: 'Hielo', icon: '🧊' },
  { key: 'cups', label: 'Cups', icon: '🥤' },
  { key: 'snack', label: 'Snack', icon: '🍦' },
  { key: 'proteina', label: 'Proteina', icon: '🥩' },
  { key: 'otros', label: 'Otros', icon: '📋' },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];

const VIEW_PREF_KEY = 'kf:ui:productViewMode';
const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 8;
const GRID_PADDING = spacing.screenPadding;
const GRID_CARD_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

// ═══ Helpers ═══

function categorizeProduct(name: string): CategoryKey {
  const n = name.toUpperCase();
  if (n.includes('BARRA') || n.includes('ROLITO') || n.includes('BOLSA DE HIELO') ||
      n.includes('MOLIDO') || n.includes('CILINDRO') || n.includes('GLOBAL ICE') ||
      n.includes('ICE')) return 'hielo';
  if (n.includes('CUP') || n.includes('MICHE') || n.includes('JUICE')) return 'cups';
  if (n.includes('KOLD POP') || n.includes('KOLD FRUIT') || n.includes('CREME') ||
      n.includes('SNACK') || n.includes('PALETA')) return 'snack';
  if (n.includes('ATUN') || n.includes('CAMARON') || n.includes('CECINA') ||
      n.includes('MACHACA') || n.includes('MEAT') || n.includes('SEA')) return 'proteina';
  return 'otros';
}

function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const words = q.split(/\s+/);
  return words.every((w) => t.includes(w));
}

/** Format visible pricelist price exactly as backend returned it. */
function displayPrice(basePrice: number): string {
  return formatCurrency(getVisiblePricelistPrice(basePrice));
}

type EnrichedProduct = TruckProduct & {
  category: CategoryKey;
  isRecommended: boolean;
  isAlreadyAdded: boolean;
  customerPrice: number; // price for this customer (may differ from list_price)
  hasCustomPrice: boolean; // true when price comes from customer pricelist
};

// ═══ Component ═══

export function ProductPicker({ visible, onClose, existingProductIds, partnerId, pricelistId, onAddLine }: ProductPickerProps) {
  const products = useProductStore((s) => s.products);
  const inventorySource = useProductStore((s) => s.inventorySource);
  // BLD-20260424-STOCKMETA: flag explícito del backend (Sebastián
  // dd78489). Reemplaza la heurística client-side anterior.
  const hasStockData = useProductStore((s) => s.hasStockData);
  const loadProducts = useProductStore((s) => s.loadProducts);
  const addSaleLine = useVisitStore((s) => s.addSaleLine);
  const forecasts = useKoldStore((s) => s.forecasts);
  const companyId = useAuthStore((s) => s.companyId);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const isGlobalFallback = inventorySource === 'global_legacy';

  const [search, setSearch] = useState('');
  // Perf Fase 1: el filtro usa el valor debounced; el input sigue ligado a
  // `search` (escribir es instantáneo) → no se re-filtra en cada tecla.
  const debouncedSearch = useDebouncedValue(search, 300);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [baseUrl, setBaseUrlState] = useState('');
  // Customer pricelist
  const [priceMap, setPriceMap] = useState<Map<number, number>>(new Map());
  const [priceLoading, setPriceLoading] = useState(false);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);

  // Load base URL for image URLs
  useEffect(() => {
    getBaseUrl().then(setBaseUrlState).catch(() => {});
  }, []);

  // Load saved view preference
  useEffect(() => {
    AsyncStorage.getItem(VIEW_PREF_KEY).then((v) => {
      if (v === 'list' || v === 'grid') setViewMode(v);
    }).catch(() => {});
  }, []);

  // Load customer-specific prices when picker opens with a partnerId
  useEffect(() => {
    if (!visible || !partnerId) {
      setPriceMap(new Map());
      setPriceLoading(false);
      return;
    }
    const pricingOptions = { companyId, fallbackPricelistId: pricelistId };
    const cached = peekCachedCustomerPrices(partnerId, products, pricingOptions);
    if (cached) {
      setPriceMap(cached);
      setPriceLoading(false);
      return;
    }
    let cancelled = false;
    setPriceLoading(true);
    computeCustomerPrices(partnerId, products, pricingOptions).then((map) => {
      if (!cancelled) {
        setPriceMap(map);
        setPriceLoading(false);
      }
      // Perf Fase 2B: persistir el precio recién computado para lectura offline
      // tras un reinicio (partner no precargado en la preparación de ruta).
      schedulePersistPriceCache();
    }).catch(() => {
      if (!cancelled) setPriceLoading(false);
    });
    return () => { cancelled = true; };
  }, [visible, partnerId, products, companyId, pricelistId]);

  const toggleView = useCallback(() => {
    const next: ViewMode = viewMode === 'list' ? 'grid' : 'list';
    setViewMode(next);
    AsyncStorage.setItem(VIEW_PREF_KEY, next).catch(() => {});
  }, [viewMode]);

  const refreshCatalog = useCallback(async () => {
    if (!warehouseId || refreshingCatalog) return;
    setRefreshingCatalog(true);
    setPriceLoading(true);
    clearPricelistCaches();
    try {
      await loadProducts(warehouseId);
      if (partnerId) {
        const pricingOptions = { companyId, fallbackPricelistId: pricelistId };
        const map = await computeCustomerPrices(partnerId, useProductStore.getState().products, pricingOptions);
        setPriceMap(map);
        schedulePersistPriceCache();
      } else {
        setPriceMap(new Map());
      }
    } finally {
      setPriceLoading(false);
      setRefreshingCatalog(false);
    }
  }, [companyId, loadProducts, partnerId, pricelistId, refreshingCatalog, warehouseId]);

  // Demand recommendations
  const recommendations = useMemo(() => {
    if (!partnerId) return new Set<number>();
    const forecast = forecasts.get(partnerId);
    if (!forecast) return new Set<number>();
    return new Set<number>();
  }, [partnerId, forecasts]);

  // Enrich products with customer price
  const enrichedProducts = useMemo(() => {
    return products.map((p) => {
      const custom = priceMap.get(p.id);
      return {
        ...p,
        category: categorizeProduct(p.name),
        isRecommended: recommendations.has(p.id),
        isAlreadyAdded: existingProductIds.includes(p.id),
        customerPrice: custom ?? p.list_price,
        hasCustomPrice: custom !== undefined,
      };
    });
  }, [products, recommendations, existingProductIds, priceMap]);

  // BLD-20260424-STOCKMETA: usamos el flag explícito hasStockData del
  // backend (commit dd78489 de Sebastián) en vez de la heurística
  // anterior "todos los qty están en 0". El backend lo calcula sobre el
  // qty_map COMPLETO del warehouse, antes de filtrar/ordenar la lista
  // que envía al cliente — así representa el stock real del almacén.
  //
  // Convención:
  //   - hasStockData === true   → modo normal: ocultar productos agotados.
  //   - hasStockData === false  → modo referencia: mostrar todos como "Agotado".
  //   - hasStockData === null   → fuente NO es truck_stock (stock_quant
  //                                o global_legacy): mostrar todos.
  const showOutOfStockAsReference = hasStockData === false || hasStockData === null;

  // Filter + sort
  const filtered = useMemo(() => {
    return enrichedProducts.filter((p) => {
      if (activeCategory !== 'all' && p.category !== activeCategory) return false;
      if (!fuzzyMatch(p.name + ' ' + (p.default_code || ''), debouncedSearch)) return false;
      // Ocultar agotados solo en modo normal (truck_stock con stock real).
      // En modo referencia o fallback global, dejamos pasar para no dejar
      // al vendedor con pantalla en blanco.
      if (!isGlobalFallback && !showOutOfStockAsReference && p.qty_display <= 0) return false;
      return true;
    }).sort((a, b) => {
      if (a.isRecommended && !b.isRecommended) return -1;
      if (!a.isRecommended && b.isRecommended) return 1;
      if (a.qty_display > 0 && b.qty_display <= 0) return -1;
      if (a.qty_display <= 0 && b.qty_display > 0) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [enrichedProducts, activeCategory, debouncedSearch, isGlobalFallback, showOutOfStockAsReference]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: enrichedProducts.length };
    enrichedProducts.forEach((p) => {
      counts[p.category] = (counts[p.category] || 0) + 1;
    });
    return counts;
  }, [enrichedProducts]);

  const setQty = useCallback((productId: number, delta: number, maxStock: number) => {
    setQuantities((prev) => {
      const current = prev[productId] || 1;
      const next = Math.max(1, Math.min(maxStock, current + delta));
      return { ...prev, [productId]: next };
    });
  }, []);

  // Perf Fase 1C: memoizado para estabilizar el onPress de cada fila.
  const handleSelect = useCallback((product: EnrichedProduct) => {
    if (product.qty_display <= 0) return;
    if (existingProductIds.includes(product.id)) return;

    const qty = quantities[product.id] || 1;
    // SaleLineItem.price = base price SIN IVA (for Odoo sync).
    // Both public and customer pricelist prices are already base values.
    const rawPrice = (typeof product.customerPrice === 'number' && !isNaN(product.customerPrice))
      ? product.customerPrice : 0;
    const line: SaleLineItem = {
      productId: product.id,
      productName: product.name,
      price: normalizeSaleLineBasePrice(rawPrice),
      qty: Math.min(qty, product.qty_display),
      stock: product.qty_display,
      weight: product.weight || 5,
    };
    if (onAddLine) {
      onAddLine(line); // caller-managed cart (e.g. Preventa)
    } else {
      addSaleLine(line); // default: active-visit cart
    }
    setSearch('');
    setQuantities({});
    onClose();
  }, [existingProductIds, quantities, onAddLine, addSaleLine, onClose]);

  // ═══ Product Image ═══

  function ProductImage({ productId, name, size }: { productId: number; name: string; size: number }) {
    const cat = categorizeProduct(name);
    const emoji = cat === 'hielo' ? '🧊' : cat === 'cups' ? '🥤' :
                  cat === 'snack' ? '🍦' : cat === 'proteina' ? '🥩' : '📦';

    // Use Odoo's /web/image endpoint — works without auth for public images
    const imageUrl = baseUrl
      ? `${baseUrl}/web/image/product.product/${productId}/image_128`
      : '';

    const [imgError, setImgError] = React.useState(false);

    if (!imageUrl || imgError) {
      return (
        <View style={[styles.imgPlaceholder, { width: size, height: size }]}>
          <Text style={{ fontSize: size * 0.4 }}>{emoji}</Text>
        </View>
      );
    }

    return (
      <Image
        source={{ uri: imageUrl }}
        style={{ width: size, height: size, borderRadius: 8 }}
        resizeMode="cover"
        onError={() => setImgError(true)}
      />
    );
  }

  // ═══ List View Row ═══

  // Perf Fase 1C: renderItem memoizado (estable entre re-renders que no cambian
  // quantities/handlers) → menos recreación de filas en FlatList.
  const renderListItem = useCallback(({ item: p }: { item: EnrichedProduct }) => {
    const outOfStock = p.qty_display <= 0;
    const alreadyAdded = p.isAlreadyAdded;
    const disabled = outOfStock || alreadyAdded;
    const qty = quantities[p.id] || 1;

    return (
      <View style={[styles.listRow, disabled && styles.rowDisabled]}>
        <ProductImage productId={p.id} name={p.name} size={44} />

        <TouchableOpacity
          style={styles.listInfo}
          onPress={() => !disabled && handleSelect(p)}
          activeOpacity={disabled ? 1 : 0.7}
          disabled={disabled}
        >
          <View style={styles.listHeader}>
            <Text style={[styles.listName, disabled && styles.textDim]} numberOfLines={1}>
              {p.name}
            </Text>
            {p.isRecommended && <Badge label="Sugerido" variant="green" />}
            {alreadyAdded && <Badge label="Agregado" variant="dim" />}
          </View>
          <View style={styles.listMeta}>
            <Text style={[styles.listPrice, disabled && styles.textDim]}>
              {displayPrice(p.customerPrice)}
            </Text>
            {p.hasCustomPrice && <Text style={styles.customPriceTag}>cliente</Text>}
            <Text style={styles.sep}>·</Text>
            <Text style={[styles.listStock, outOfStock && styles.textRed]}>
              {outOfStock ? 'Agotado' : `${p.qty_display} disp.`}
            </Text>
          </View>
        </TouchableOpacity>

        {!disabled && (
          <View style={styles.qtyRow}>
            <TouchableOpacity style={styles.qtyBtn} onPress={() => setQty(p.id, -1, p.qty_display)}>
              <Text style={styles.qtyBtnText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.qtyVal}>{qty}</Text>
            <TouchableOpacity
              style={[styles.qtyBtn, qty >= p.qty_display && styles.qtyBtnOff]}
              onPress={() => setQty(p.id, 1, p.qty_display)}
              disabled={qty >= p.qty_display}
            >
              <Text style={styles.qtyBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [quantities, handleSelect, setQty]);

  // ═══ Grid View Card ═══

  const renderGridItem = useCallback(({ item: p }: { item: EnrichedProduct }) => {
    const outOfStock = p.qty_display <= 0;
    const alreadyAdded = p.isAlreadyAdded;
    const disabled = outOfStock || alreadyAdded;
    const qty = quantities[p.id] || 1;

    return (
      <View style={[styles.gridCard, disabled && styles.rowDisabled]}>
        <TouchableOpacity
          onPress={() => !disabled && handleSelect(p)}
          activeOpacity={disabled ? 1 : 0.7}
          disabled={disabled}
          style={styles.gridTouchArea}
        >
          <View style={styles.gridImgWrap}>
            <ProductImage productId={p.id} name={p.name} size={GRID_CARD_WIDTH - 24} />
            {p.isRecommended && (
              <View style={styles.gridBadge}>
                <Text style={styles.gridBadgeText}>Sugerido</Text>
              </View>
            )}
            {alreadyAdded && (
              <View style={[styles.gridBadge, styles.gridBadgeDim]}>
                <Text style={styles.gridBadgeText}>Agregado</Text>
              </View>
            )}
          </View>

          <Text style={[styles.gridName, disabled && styles.textDim]} numberOfLines={2}>
            {p.name}
          </Text>

          <View style={styles.gridPriceRow}>
            <Text style={[styles.gridPrice, disabled && styles.textDim]}>
              {displayPrice(p.customerPrice)}
            </Text>
            {p.hasCustomPrice && <Text style={styles.customPriceTagSm}>cliente</Text>}
          </View>

          <Text style={[styles.gridStock, outOfStock && styles.textRed]}>
            {outOfStock ? 'Agotado' : `${p.qty_display} disp.`}
          </Text>
        </TouchableOpacity>

        {!disabled && (
          <View style={styles.gridQtyRow}>
            <TouchableOpacity style={styles.qtyBtnSm} onPress={() => setQty(p.id, -1, p.qty_display)}>
              <Text style={styles.qtyBtnText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.qtyVal}>{qty}</Text>
            <TouchableOpacity
              style={[styles.qtyBtnSm, qty >= p.qty_display && styles.qtyBtnOff]}
              onPress={() => setQty(p.id, 1, p.qty_display)}
              disabled={qty >= p.qty_display}
            >
              <Text style={styles.qtyBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [quantities, handleSelect, setQty]);

  const inStockCount = filtered.filter((p) => p.qty_display > 0 && !p.isAlreadyAdded).length;
  const hasCustomPrices = priceMap.size > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.modal}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={typography.screenTitle}>Agregar Producto</Text>
          <TouchableOpacity onPress={() => { setSearch(''); setQuantities({}); onClose(); }}>
            <Text style={styles.closeBtn}>Cerrar</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.toolbarRow}>
          <TouchableOpacity
            style={[styles.refreshBtn, (!warehouseId || refreshingCatalog) && styles.refreshBtnDisabled]}
            onPress={refreshCatalog}
            disabled={!warehouseId || refreshingCatalog}
          >
            <Text style={styles.refreshBtnLabel}>
              {refreshingCatalog ? 'Refrescando' : 'Refrescar'}
            </Text>
          </TouchableOpacity>
          {/* View toggle — plain text, works on all devices */}
          <TouchableOpacity style={styles.viewToggle} onPress={toggleView}>
            <Text style={styles.viewToggleLabel}>
              {viewMode === 'list' ? 'Ver Grid' : 'Ver Lista'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Perf Fase 2C: badge discreto de datos en caché / sin conexión. */}
        <CacheStatusBadge showDetail style={{ marginHorizontal: spacing.md, marginBottom: spacing.xs }} />

        {/* Banners */}
        {isGlobalFallback && (
          <View style={styles.fallbackBanner}>
            <Text style={styles.fallbackText}>
              Inventario global — stock puede no reflejar tu unidad
            </Text>
          </View>
        )}

        {/* Search */}
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre o codigo..."
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity style={styles.clearBtn} onPress={() => setSearch('')}>
              <Text style={styles.clearBtnText}>X</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Category tabs */}
        <FlatList
          horizontal
          data={CATEGORIES}
          keyExtractor={(c) => c.key}
          showsHorizontalScrollIndicator={false}
          style={styles.catList}
          contentContainerStyle={styles.catBar}
          renderItem={({ item: cat }) => (
            <TouchableOpacity
              style={[styles.catTab, activeCategory === cat.key && styles.catTabActive]}
              onPress={() => setActiveCategory(cat.key)}
            >
              <Text style={styles.catIcon}>{cat.icon}</Text>
              <Text style={[styles.catLabel, activeCategory === cat.key && styles.catLabelActive]}>
                {cat.label}
              </Text>
              <Text style={styles.catCount}>{categoryCounts[cat.key] || 0}</Text>
            </TouchableOpacity>
          )}
        />

        {/* Info bar */}
        <View style={styles.infoBar}>
          <Text style={styles.infoText}>
            {inStockCount} disponible{inStockCount !== 1 ? 's' : ''}
            {priceLoading ? ' · Cargando precios...' : ''}
          </Text>
          <Text style={styles.infoText}>
            {hasCustomPrices ? 'Precio lista cliente' : 'Precio lista'}
          </Text>
        </View>

        {/* Product list or grid — key forces FlatList remount on view change */}
        {viewMode === 'list' ? (
          <FlatList
            key="product-list"
            data={filtered}
            renderItem={renderListItem}
            keyExtractor={(p) => String(p.id)}
            contentContainerStyle={styles.listContainer}
            initialNumToRender={15}
            maxToRenderPerBatch={10}
            windowSize={5}
            ListEmptyComponent={<EmptyState search={search} activeCategory={activeCategory} />}
          />
        ) : (
          <FlatList
            key="product-grid"
            data={filtered}
            renderItem={renderGridItem}
            keyExtractor={(p) => String(p.id)}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridContainer}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={5}
            ListEmptyComponent={<EmptyState search={search} activeCategory={activeCategory} />}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ═══ Empty State ═══

function EmptyState({ search, activeCategory }: { search: string; activeCategory: string }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={{ fontSize: 32, marginBottom: 8 }}>📦</Text>
      <Text style={typography.dim}>
        {search
          ? `Sin resultados para "${search}"`
          : activeCategory !== 'all'
            ? 'Sin productos en esta categoria'
            : 'No hay productos disponibles'}
      </Text>
    </View>
  );
}

// ═══ Styles ═══

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.screenPadding, paddingVertical: 12,
  },
  closeBtn: { fontSize: 14, color: colors.primary, fontWeight: '600' },

  toolbarRow: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8,
    paddingHorizontal: spacing.screenPadding, marginTop: -4, marginBottom: 8,
  },
  refreshBtn: {
    backgroundColor: colors.card, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  refreshBtnDisabled: { opacity: 0.65 },
  refreshBtnLabel: { fontSize: 12, color: colors.primary, fontWeight: '600' },

  viewToggle: {
    backgroundColor: colors.card, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  viewToggleLabel: { fontSize: 12, color: colors.primary, fontWeight: '600' },

  searchWrap: {
    paddingHorizontal: spacing.screenPadding, marginBottom: 8, position: 'relative',
  },
  searchInput: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.button, paddingHorizontal: 14, paddingVertical: 11,
    paddingRight: 40, color: colors.text, fontSize: 14,
  },
  clearBtn: { position: 'absolute', right: spacing.screenPadding + 10, top: 9, padding: 4 },
  clearBtnText: { color: colors.textDim, fontSize: 16, fontWeight: '700' },

  catList: { maxHeight: 44, flexGrow: 0 },
  catBar: { paddingHorizontal: spacing.screenPadding, paddingBottom: 6, gap: 6 },
  catTab: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: colors.card, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  catTabActive: { backgroundColor: 'rgba(37,99,235,0.12)', borderColor: '#2563EB' },
  catIcon: { fontSize: 13 },
  catLabel: { fontSize: 11, color: colors.textDim, fontWeight: '500' },
  catLabelActive: { color: '#2563EB' },
  catCount: { fontSize: 10, color: colors.textDim },

  infoBar: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: spacing.screenPadding, paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  infoText: { fontSize: 11, color: colors.textDim },

  // ═══ LIST VIEW ═══
  listContainer: { paddingHorizontal: spacing.screenPadding, paddingBottom: 80, paddingTop: 6 },
  listRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 10, paddingHorizontal: 12, gap: 10,
    backgroundColor: colors.card, borderRadius: radii.button, marginBottom: 6,
  },
  listInfo: { flex: 1 },
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  listName: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },
  listMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  listPrice: { fontSize: 13, color: colors.primary, fontWeight: '700' },
  listStock: { fontSize: 11, color: '#22C55E' },
  listWeight: { fontSize: 11, color: colors.textDim },
  sep: { fontSize: 10, color: colors.textDim },
  customPriceTag: {
    fontSize: 9, color: '#22C55E', fontWeight: '700',
    backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 3,
    paddingHorizontal: 4, paddingVertical: 1, overflow: 'hidden',
  },
  customPriceTagSm: {
    fontSize: 8, color: '#22C55E', fontWeight: '700',
    backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 3,
    paddingHorizontal: 3, paddingVertical: 1, overflow: 'hidden',
    marginLeft: 3,
  },

  // ═══ GRID VIEW ═══
  gridContainer: { paddingHorizontal: spacing.screenPadding, paddingBottom: 80, paddingTop: 6 },
  gridRow: { justifyContent: 'space-between', marginBottom: GRID_GAP },
  gridCard: {
    width: GRID_CARD_WIDTH, backgroundColor: colors.card,
    borderRadius: radii.card, overflow: 'hidden',
  },
  gridTouchArea: { padding: 10, alignItems: 'center' },
  gridImgWrap: { width: '100%', alignItems: 'center', marginBottom: 8, position: 'relative' },
  gridBadge: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(34,197,94,0.85)', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  gridBadgeDim: { backgroundColor: 'rgba(139,149,163,0.6)' },
  gridBadgeText: { fontSize: 9, color: '#FFF', fontWeight: '700' },
  gridName: {
    fontSize: 12, fontWeight: '600', color: colors.text,
    textAlign: 'center', lineHeight: 16, minHeight: 32,
  },
  gridPriceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  gridPrice: {
    fontSize: 15, fontWeight: '700', color: colors.primary, textAlign: 'center',
  },
  gridStock: {
    fontSize: 11, color: '#22C55E', textAlign: 'center', marginTop: 2,
  },
  gridQtyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: colors.border,
  },

  // ═══ SHARED ═══
  imgPlaceholder: {
    borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  rowDisabled: { opacity: 0.4 },
  textDim: { color: colors.textDim },
  textRed: { color: '#EF4444' },

  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 8 },
  qtyBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnSm: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 17, color: colors.text, fontWeight: '600' },
  qtyVal: {
    fontSize: 15, fontWeight: '700', color: colors.text,
    minWidth: 24, textAlign: 'center',
  },
  qtyBtnOff: { opacity: 0.3 },

  fallbackBanner: {
    backgroundColor: colors.warningAlpha08,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)',
    borderRadius: radii.button, marginHorizontal: spacing.screenPadding,
    marginBottom: 8, padding: 8, alignItems: 'center',
  },
  fallbackText: { fontSize: 11, color: '#F59E0B', fontWeight: '600' },
  emptyCard: {
    backgroundColor: colors.card, borderRadius: radii.card,
    padding: 30, alignItems: 'center', marginTop: 20,
  },
});
