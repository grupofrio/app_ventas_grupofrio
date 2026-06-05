/**
 * Inventory tab — s-inv in mockup (lines 323-348).
 * Truck stock overview, product list, action buttons.
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Card } from '../../src/components/ui/Card';
import { AlertBanner } from '../../src/components/ui/AlertBanner';
import { RouteLoadAcceptanceCard } from '../../src/components/domain/RouteLoadAcceptanceCard';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useProductStore } from '../../src/stores/useProductStore';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { formatCatalogPrice } from '../../src/utils/time';
import { useAsyncRefresh } from '../../src/hooks/useAsyncRefresh';
import { shouldRefreshProductsOnFocus } from '../../src/utils/productLoading';

export default function InventoryScreen() {
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const isOnline = useSyncStore((s) => s.isOnline);
  const { plan, loadPlan } = useRouteStore();
  const {
    products, totalStockKg, isLoading, error, loadProducts,
    productCount, lastSync: productsLastSync,
  } = useProductStore();
  const refreshInventory = useCallback(async () => {
    const tasks: Promise<void>[] = [];
    if (warehouseId) {
      tasks.push(Promise.resolve(loadProducts(warehouseId)));
    }
    if (isOnline) {
      tasks.push(loadPlan());
    }
    await Promise.all(tasks);
  }, [isOnline, loadPlan, warehouseId, loadProducts]);
  const { refreshing, onRefresh } = useAsyncRefresh(refreshInventory);

  // BLD-20260424-LOOP: ver nota en productLoading.ts. Pasamos productCount
  // y lastSync para evitar el ciclo de re-fetch en cada cambio de loading.
  useFocusEffect(
    useCallback(() => {
      if (shouldRefreshProductsOnFocus(
        warehouseId, isLoading, productCount, productsLastSync,
      )) {
        void loadProducts(warehouseId!);
      }
      if (isOnline) {
        void loadPlan();
      }
    }, [warehouseId, isLoading, productCount, productsLastSync, loadProducts, isOnline, loadPlan])
  );

  // Forecast total for route (F5: real aggregation)
  const forecastKg = 0; // Placeholder until KoldDemand integration
  const bufferKg = totalStockKg - forecastKg;
  const bufferPct = totalStockKg > 0 ? Math.round((bufferKg / totalStockKg) * 100) : 0;
  const fillPct = forecastKg > 0 && totalStockKg > 0
    ? Math.min(100, Math.round((forecastKg / totalStockKg) * 100))
    : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="📦 Camioneta" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Stock summary card */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View>
              <Text style={styles.summaryLabel}>Stock total</Text>
              <Text style={styles.summaryValue}>{totalStockKg} kg</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.summaryLabel}>Forecast ruta</Text>
              <Text style={[styles.summaryValue, { color: colors.primary }]}>
                {forecastKg > 0 ? `${forecastKg} kg` : '-- kg'}
              </Text>
            </View>
          </View>

          {/* Progress bar */}
          {forecastKg > 0 && (
            <>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${fillPct}%` }]} />
              </View>
              <Text style={styles.bufferText}>
                Buffer: {bufferKg} kg ({bufferPct}%)
                {bufferPct >= 20 ? ' — ✅ Suficiente' : ' — ⚠️ Bajo'}
              </Text>
            </>
          )}

          {forecastKg === 0 && (
            <Text style={[styles.bufferText, { marginTop: 8 }]}>
              F5: Forecast de ruta desde KoldDemand
            </Text>
          )}
        </Card>

        <RouteLoadAcceptanceCard
          plan={plan}
          isOnline={isOnline}
          warehouseId={warehouseId}
          loadPlan={loadPlan}
          loadProducts={loadProducts}
          showLoadLines
          showAcceptedLoads
        />

        {/* Product list */}
        <Text style={styles.sectionTitle}>INVENTARIO FÍSICO REAL</Text>
        {isLoading ? (
          <Card><Text style={typography.dim}>Cargando productos...</Text></Card>
        ) : error ? (
          <AlertBanner icon="❌" variant="critical" message={error} />
        ) : products.length === 0 ? (
          <Card>
            <Text style={typography.dim}>Sin productos en camioneta</Text>
            <Text style={[typography.dimSmall, { marginTop: 4 }]}>
              Acepta la carga o recarga asignada para reflejar inventario.
            </Text>
          </Card>
        ) : (
          products
            .filter((p) => p.qty_available > 0)
            .map((p) => (
              <View key={p.id} style={styles.productRow}>
                <Text style={styles.productName} numberOfLines={1}>
                  {p.name.includes('Hielo') || p.name.includes('Barra') ? '🧊 ' : '🥤 '}
                  {p.name}
                </Text>
                <View style={styles.productRight}>
                  <Text style={styles.productPrice}>
                    {formatCatalogPrice(p.list_price)}
                  </Text>
                  <Text style={styles.productQty}>
                    {p.qty_display} disp. · {p._totalKg.toFixed(0)}kg
                    {(p as any).qty_reserved > 0 ? ` · ${(p as any).qty_reserved} res.` : ''}
                  </Text>
                </View>
              </View>
            ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  // Summary card
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 16,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 11, color: colors.textDim },
  summaryValue: {
    fontFamily: fonts.monoBold, fontSize: 24, fontWeight: '700', color: colors.text,
  },
  progressBar: {
    height: 5, backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 3, overflow: 'hidden', marginTop: 10,
  },
  progressFill: {
    height: '100%', borderRadius: 3, backgroundColor: colors.success,
  },
  bufferText: { fontSize: 10, color: colors.textDim, marginTop: 4 },
  // Section
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  // Product rows
  productRow: {
    backgroundColor: colors.card, borderRadius: radii.button,
    padding: 10, paddingHorizontal: 14, marginBottom: 5,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  productName: { flex: 1, fontSize: 13, color: colors.text, marginRight: 8 },
  productRight: { alignItems: 'flex-end' },
  productPrice: {
    fontFamily: fonts.monoBold, fontSize: 13, fontWeight: '700', color: colors.primary,
  },
  productQty: {
    fontFamily: fonts.monoBold, fontSize: 11, fontWeight: '500', color: colors.textDim,
    marginTop: 1,
  },
});
