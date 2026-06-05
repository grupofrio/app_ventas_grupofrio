import React, { useCallback, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSegments } from 'expo-router';
import { colors, radii, sizes, spacing } from '../../theme/tokens';
import { clearPricelistCaches } from '../../services/pricelist';
import { useAuthStore } from '../../stores/useAuthStore';
import { useProductStore } from '../../stores/useProductStore';
import { useRouteStore } from '../../stores/useRouteStore';

export function GlobalRefreshButton() {
  const segments = useSegments();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const loadProducts = useProductStore((s) => s.loadProducts);
  const loadPlan = useRouteStore((s) => s.loadPlan);
  const inAuthGroup = segments[0] === '(auth)';
  const inTabsGroup = segments[0] === '(tabs)';
  const [refreshing, setRefreshing] = useState(false);

  const refreshOperationalData = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    clearPricelistCaches();
    try {
      await Promise.all([
        loadPlan(),
        warehouseId ? loadProducts(warehouseId) : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [loadPlan, loadProducts, refreshing, warehouseId]);

  if (!isAuthenticated || inAuthGroup) {
    return null;
  }

  return (
    <TouchableOpacity
      accessibilityLabel="Refrescar inventario, precios y ruta"
      accessibilityRole="button"
      activeOpacity={0.82}
      disabled={refreshing}
      onPress={refreshOperationalData}
      style={[
        styles.button,
        inTabsGroup && styles.buttonAboveTabs,
        refreshing && styles.buttonRefreshing,
      ]}
    >
      <Ionicons name={refreshing ? 'sync' : 'refresh'} size={22} color={colors.textOnPrimary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: spacing.screenPadding,
    bottom: spacing.xxl + 58,
    width: 50,
    height: 50,
    borderRadius: radii.circle,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  buttonAboveTabs: {
    bottom: sizes.bottomNavHeight + spacing.xl + 58,
  },
  buttonRefreshing: {
    opacity: 0.72,
  },
});
