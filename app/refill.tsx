/**
 * Refill screen — s-refill in mockup (lines 350-362).
 * Request additional product from warehouse.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { colors, spacing, radii } from '../src/theme/tokens';
import { fonts } from '../src/theme/typography';
import { useProductStore } from '../src/stores/useProductStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useAsyncRefresh } from '../src/hooks/useAsyncRefresh';

interface RefillLine {
  productId: number;
  productName: string;
  qty: number;
}

export default function RefillScreen() {
  const router = useRouter();
  const products = useProductStore((s) => s.products);
  const isLoadingProducts = useProductStore((s) => s.isLoading);
  const productError = useProductStore((s) => s.error);
  const loadProducts = useProductStore((s) => s.loadProducts);
  const enqueue = useSyncStore((s) => s.enqueue);
  const warehouseId = useAuthStore((s) => s.warehouseId);

  const [lines, setLines] = useState<RefillLine[]>([]);
  const [notes, setNotes] = useState('');
  const refreshProducts = useCallback(async () => {
    if (!warehouseId) return;
    await loadProducts(warehouseId);
  }, [warehouseId, loadProducts]);
  const { refreshing, onRefresh } = useAsyncRefresh(refreshProducts);

  // BLD-20260404-008: Auto-load products if store is empty.
  // Previously this screen depended on the user visiting the Inventory tab
  // first (which is the only place that calls loadProducts). Opening
  // "Solicitar Carga" from any other entry point showed an empty list.
  useEffect(() => {
    if (warehouseId && products.length === 0 && !isLoadingProducts) {
      loadProducts(warehouseId);
    }
  }, [warehouseId]);

  function updateQty(productId: number, productName: string, delta: number) {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        const newQty = Math.max(0, existing.qty + delta);
        if (newQty === 0) return prev.filter((l) => l.productId !== productId);
        return prev.map((l) => l.productId === productId ? { ...l, qty: newQty } : l);
      }
      if (delta > 0) {
        return [...prev, { productId, productName, qty: delta }];
      }
      return prev;
    });
  }

  function handleSubmit() {
    if (lines.length === 0) {
      Alert.alert('Sin productos', 'Agrega al menos un producto');
      return;
    }

    enqueue('prospection', {
      type: 'refill',
      model: 'van.refill.request',
      warehouse_id: warehouseId,
      lines: lines.map((l) => ({ product_id: l.productId, qty: l.qty })),
      notes,
      timestamp: Date.now(),
    });

    Alert.alert('Solicitud enviada', 'Tu solicitud de carga fue registrada.');
    router.back();
  }

  // Show products that could be refilled
  const refillableProducts = products.slice(0, 10);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Solicitar Carga" showBack />

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
        <Text style={styles.hint}>Solicita producto adicional a tu almacen/sucursal.</Text>

        <Text style={styles.sectionTitle}>PRODUCTOS A SOLICITAR</Text>
        {isLoadingProducts && products.length === 0 && (
          <View style={styles.emptyState}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.emptyStateText}>Cargando productos...</Text>
          </View>
        )}
        {!isLoadingProducts && products.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              {productError || 'No hay productos disponibles. Verifica tu conexion.'}
            </Text>
            {warehouseId && (
              <Button
                label="Reintentar"
                variant="secondary"
                small
                onPress={() => loadProducts(warehouseId)}
                style={{ marginTop: 8 }}
              />
            )}
          </View>
        )}
        {refillableProducts.map((p) => {
          const line = lines.find((l) => l.productId === p.id);
          return (
            <View key={p.id} style={styles.productLine}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{p.name}</Text>
                <Text style={styles.productInfo}>
                  En camioneta: {p.qty_available}
                </Text>
              </View>
              <View style={styles.qtyControls}>
                <Button
                  label="−"
                  variant="secondary"
                  small
                  onPress={() => updateQty(p.id, p.name, -1)}
                  style={styles.qtyBtn}
                />
                <Text style={styles.qtyValue}>{line?.qty || 0}</Text>
                <Button
                  label="+"
                  variant="secondary"
                  small
                  onPress={() => updateQty(p.id, p.name, 1)}
                  style={styles.qtyBtn}
                />
              </View>
            </View>
          );
        })}

        <Text style={styles.inputLabel}>NOTAS</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Motivo de la solicitud..."
          placeholderTextColor={colors.textDim}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={2}
        />

        <Button
          label="📥 Enviar Solicitud de Carga"
          onPress={handleSubmit}
          fullWidth
          disabled={lines.length === 0}
          style={{ marginTop: 14 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  hint: { fontSize: 12, color: colors.textDim, marginBottom: 14 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  inputLabel: {
    fontSize: 11, fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.4, color: colors.textDim, marginTop: 14, marginBottom: 5,
  },
  productLine: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, paddingHorizontal: 12,
    backgroundColor: colors.cardLighter, borderRadius: radii.button, marginBottom: 5,
  },
  productName: { fontSize: 13, fontWeight: '600', color: colors.text },
  productInfo: { fontSize: 11, color: colors.textDim },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: { width: 30, minHeight: 30, paddingHorizontal: 0 },
  qtyValue: {
    fontFamily: fonts.monoBold, fontSize: 15, fontWeight: '700',
    color: colors.text, minWidth: 24, textAlign: 'center',
  },
  textArea: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.button, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontSize: 15, minHeight: 60, textAlignVertical: 'top',
  },
  emptyState: {
    alignItems: 'center', justifyContent: 'center',
    padding: 16, backgroundColor: colors.cardLighter,
    borderRadius: radii.button, marginBottom: 8, gap: 6,
  },
  emptyStateText: {
    fontSize: 12, color: colors.textDim, textAlign: 'center',
  },
});
