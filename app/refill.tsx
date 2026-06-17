/**
 * Refill screen — s-refill in mockup (lines 350-362).
 * Request additional product from warehouse.
 *
 * Fix (2026-06-17): antes mostraba `products.slice(0, 10)` que, con el orden del
 * store (qty_available desc), ocultaba los productos agotados/bajo stock que son
 * justamente los que hay que pedir. Ahora la lista es completa, virtualizada
 * (FlatList) y buscable, ordenada por menor stock primero. El envío incluye un
 * `operation_id` estable para idempotencia (doble-tap / reintento).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { colors, spacing, radii } from '../src/theme/tokens';
import { fonts } from '../src/theme/typography';
import { useProductStore, TruckProduct } from '../src/stores/useProductStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useAsyncRefresh } from '../src/hooks/useAsyncRefresh';
import { useDebouncedValue } from '../src/hooks/useDebouncedValue';
import { filterAndSortRefillProducts, buildRefillPayload } from '../src/services/refillLogic';

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
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Perf Fase 1: el filtro usa el valor debounced; escribir es instantáneo.
  const debouncedSearch = useDebouncedValue(search, 300);

  const refreshProducts = useCallback(async () => {
    if (!warehouseId) return;
    await loadProducts(warehouseId);
  }, [warehouseId, loadProducts]);
  const { refreshing, onRefresh } = useAsyncRefresh(refreshProducts);

  // BLD-20260404-008: Auto-load products if store is empty.
  useEffect(() => {
    if (warehouseId && products.length === 0 && !isLoadingProducts) {
      loadProducts(warehouseId);
    }
  }, [warehouseId]);

  // Lista completa, ordenada (menor stock primero) y filtrada por búsqueda.
  const visibleProducts = useMemo(
    () => filterAndSortRefillProducts(products, debouncedSearch),
    [products, debouncedSearch],
  );

  const updateQty = useCallback((productId: number, productName: string, delta: number) => {
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
  }, []);

  // Perf Fase 1: operation_id ESTABLE por intento (mismo id si el vendedor
  // reintenta el mismo borrador) para que el backend deduplique. Se regenera
  // tras un envío exitoso. La cola de sync ya añade su propio _operationId.
  const operationIdRef = useRef<string | null>(null);
  function getRefillOperationId(): string {
    if (!operationIdRef.current) {
      operationIdRef.current = `refill-${warehouseId ?? 'na'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return operationIdRef.current;
  }

  function handleSubmit() {
    if (submitting) return; // guard doble-tap
    if (lines.length === 0) {
      Alert.alert('Sin productos', 'Agrega al menos un producto');
      return;
    }
    setSubmitting(true);
    try {
      enqueue('prospection', buildRefillPayload({
        warehouseId,
        lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        notes,
        operationId: getRefillOperationId(),
        timestampMs: Date.now(),
      }));
      operationIdRef.current = null; // siguiente solicitud = nuevo id
      Alert.alert('Solicitud enviada', 'Tu solicitud de carga fue registrada.');
      router.back();
    } finally {
      setSubmitting(false);
    }
  }

  const renderProduct = useCallback(({ item: p }: { item: TruckProduct }) => {
    const line = lines.find((l) => l.productId === p.id);
    const isOut = !(p.qty_available > 0);
    return (
      <View style={styles.productLine}>
        <View style={{ flex: 1 }}>
          <Text style={styles.productName}>{p.name}</Text>
          <Text style={[styles.productInfo, isOut && styles.productOut]}>
            En camioneta: {p.qty_available}{isOut ? ' · Agotado' : ''}
          </Text>
        </View>
        <View style={styles.qtyControls}>
          <Button label="−" variant="secondary" small onPress={() => updateQty(p.id, p.name, -1)} style={styles.qtyBtn} />
          <Text style={styles.qtyValue}>{line?.qty || 0}</Text>
          <Button label="+" variant="secondary" small onPress={() => updateQty(p.id, p.name, 1)} style={styles.qtyBtn} />
        </View>
      </View>
    );
  }, [lines, updateQty]);

  const ListHeader = (
    <>
      <Text style={styles.hint}>Solicita producto adicional a tu almacen/sucursal.</Text>
      <TextInput
        style={styles.search}
        placeholder="Buscar producto…"
        placeholderTextColor={colors.textDim}
        value={search}
        onChangeText={setSearch}
        accessibilityLabel="Buscar producto para solicitar"
      />
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>PRODUCTOS A SOLICITAR</Text>
        {products.length > 0 && (
          <Text style={styles.countHint}>{visibleProducts.length} de {products.length}</Text>
        )}
      </View>
    </>
  );

  const ListEmpty = (
    <View style={styles.emptyState}>
      {isLoadingProducts && products.length === 0 ? (
        <>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.emptyStateText}>Cargando productos...</Text>
        </>
      ) : products.length === 0 ? (
        <>
          <Text style={styles.emptyStateText}>
            {productError || 'No hay productos disponibles. Verifica tu conexion.'}
          </Text>
          {warehouseId && (
            <Button label="Reintentar" variant="secondary" small onPress={() => loadProducts(warehouseId)} style={{ marginTop: 8 }} />
          )}
        </>
      ) : (
        <Text style={styles.emptyStateText}>Sin coincidencias para “{search}”.</Text>
      )}
    </View>
  );

  const ListFooter = (
    <>
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
        label={submitting ? 'Enviando…' : '📥 Enviar Solicitud de Carga'}
        onPress={handleSubmit}
        fullWidth
        disabled={lines.length === 0 || submitting}
        loading={submitting}
        style={{ marginTop: 14 }}
      />
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Solicitar Carga" showBack />
      <FlatList
        data={visibleProducts}
        keyExtractor={(p) => String(p.id)}
        renderItem={renderProduct}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  hint: { fontSize: 12, color: colors.textDim, marginTop: 12, marginBottom: 12 },
  search: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.button, paddingHorizontal: 14, paddingVertical: 10,
    color: colors.text, fontSize: 15, marginBottom: 4,
  },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim,
  },
  countHint: { fontSize: 11, color: colors.textDim },
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
  productOut: { color: '#EF4444', fontWeight: '700' },
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
