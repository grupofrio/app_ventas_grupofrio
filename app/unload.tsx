/**
 * Unload screen — s-unload in mockup (lines 364-376).
 * Return product to warehouse at end of day.
 */

import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { colors, spacing, radii } from '../src/theme/tokens';
import { fonts } from '../src/theme/typography';
import { useProductStore } from '../src/stores/useProductStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import { buildLocalStockDelta } from '../src/services/stockRollback';

const UNLOAD_REASONS = ['Fin de ruta', 'Producto danado', 'Merma', 'Otro'];

export default function UnloadScreen() {
  const router = useRouter();
  const products = useProductStore((s) => s.products);
  const updateLocalStock = useProductStore((s) => s.updateLocalStock);
  const enqueue = useSyncStore((s) => s.enqueue);

  const [reason, setReason] = useState('Fin de ruta');
  const [returnQtys, setReturnQtys] = useState<Record<number, number>>({});
  // Idempotencia: guard doble-tap + operation_id ESTABLE por intento (paridad
  // con refill). El backend puede deduplicar; un backend que lo ignore no rompe.
  const submittingRef = useRef(false);
  const operationIdRef = useRef<string | null>(null);
  function getUnloadOperationId(): string {
    if (!operationIdRef.current) {
      operationIdRef.current = `unload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return operationIdRef.current;
  }

  const productsWithStock = products.filter((p) => p.qty_available > 0);

  function updateQty(productId: number, maxQty: number, delta: number) {
    setReturnQtys((prev) => {
      const current = prev[productId] || 0;
      const newQty = Math.max(0, Math.min(maxQty, current + delta));
      return { ...prev, [productId]: newQty };
    });
  }

  function handleConfirm() {
    if (submittingRef.current) return; // guard doble-tap
    const lines = Object.entries(returnQtys)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ product_id: Number(id), qty }));

    if (lines.length === 0) {
      Alert.alert('Sin productos', 'Selecciona al menos un producto para devolver');
      return;
    }

    submittingRef.current = true;

    // PR-3a: NO se cambia el ruteo (sigue 'prospection' → PR-3b). Se adjunta un
    // `_localStockDelta` explícito (unload descuenta → sign -1) para que el
    // rollback genérico pueda revertir el stock local si el ítem muere en sync,
    // aunque el type sea 'prospection'. `operation_id` estable para idempotencia.
    enqueue('prospection', {
      type: 'unload',
      model: 'van.unload.request',
      operation_id: getUnloadOperationId(),
      lines,
      reason,
      timestamp: Date.now(),
      _localStockDelta: buildLocalStockDelta(lines, -1),
    });

    // Descuento optimista de stock local (consistente con _localStockDelta).
    lines.forEach((l) => updateLocalStock(l.product_id, -l.qty));

    operationIdRef.current = null; // siguiente devolución = nuevo id
    Alert.alert('Devolucion registrada', 'Los productos fueron devueltos.');
    router.back();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Devolucion a Almacen" showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={styles.hint}>
          Registra producto que regresas al almacen al final del dia.
        </Text>

        <Text style={styles.sectionTitle}>PRODUCTO A DEVOLVER</Text>
        {productsWithStock.map((p) => {
          const qty = returnQtys[p.id] || 0;
          return (
            <View key={p.id} style={styles.productLine}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{p.name}</Text>
                <Text style={styles.productInfo}>
                  En camioneta: {p.qty_available}
                </Text>
              </View>
              <View style={styles.qtyControls}>
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateQty(p.id, p.qty_available, -1)}
                >
                  <Text style={styles.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qtyValue}>{qty}</Text>
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateQty(p.id, p.qty_available, 1)}
                >
                  <Text style={styles.qtyBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        <Text style={styles.inputLabel}>MOTIVO</Text>
        <View style={styles.chipContainer}>
          {UNLOAD_REASONS.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.chip, reason === r && styles.chipSelected]}
              onPress={() => setReason(r)}
            >
              <Text style={[styles.chipText, reason === r && styles.chipTextSelected]}>
                {r}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Button
          label="📤 Confirmar Devolucion"
          onPress={handleConfirm}
          fullWidth
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
  qtyBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 16, color: colors.text },
  qtyValue: {
    fontFamily: fonts.monoBold, fontSize: 15, fontWeight: '700',
    color: colors.text, minWidth: 24, textAlign: 'center',
  },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    backgroundColor: colors.cardLighter, borderWidth: 1, borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primaryAlpha12, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.text },
  chipTextSelected: { color: colors.primary },
});
