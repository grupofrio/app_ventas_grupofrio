/**
 * Preventa (Presale) screen — MVP.
 *
 * Crea una COTIZACIÓN en Odoo (draft), NO una venta confirmada. Lleva fecha de
 * entrega (commitment_date), sin pago, sin checkout, sin afectar inventario de
 * ruta ni liquidación. Prioriza cliente existente; lead bloqueado salvo que el
 * backend lo soporte.
 *
 * Reutiliza: searchOffrouteEntities (cliente/lead), ProductPicker (vía
 * onAddLine → carrito local, sin tocar el carrito de visita), precios por
 * cliente, SaleLineItem.
 *
 * ⚠️ El backend de preventa aún no existe (ver presale.ts). Mientras
 * PRESALE_BACKEND_ENABLED sea false, el confirmar muestra bloqueo claro y NO
 * simula éxito.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { Badge } from '../src/components/ui/Badge';
import { ProductPicker } from '../src/components/domain/ProductPicker';
import { colors, spacing, radii } from '../src/theme/tokens';
import { fonts } from '../src/theme/typography';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useRouteStore } from '../src/stores/useRouteStore';
import { useProductStore } from '../src/stores/useProductStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import type { SaleLineItem } from '../src/stores/useVisitStore';
import { searchOffrouteEntities, OffrouteSearchResult } from '../src/services/offrouteSearch';
import { todayLocalISO } from '../src/utils/localDate';
import { formatCurrency } from '../src/utils/time';
import {
  buildPresalePayload, computeCartTotal, addDaysIso,
} from '../src/services/presaleLogic';
import {
  createPresale, PresaleNotEnabledError, PRESALE_BACKEND_ENABLED, PRESALE_LEAD_SUPPORTED,
} from '../src/services/presale';

function makeOperationId(): string {
  return `presale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function PresaleScreen() {
  const router = useRouter();
  const employeeId = useAuthStore((s) => s.employeeId);
  const companyId = useAuthStore((s) => s.companyId);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const planId = useRouteStore((s) => s.plan?.plan_id ?? null);
  const isOnline = useSyncStore((s) => s.isOnline);
  const products = useProductStore((s) => s.products);
  const loadProducts = useProductStore((s) => s.loadProducts);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<OffrouteSearchResult[]>([]);
  const [selected, setSelected] = useState<OffrouteSearchResult | null>(null);

  const [cart, setCart] = useState<SaleLineItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const today = todayLocalISO();
  const [deliveryDate, setDeliveryDate] = useState(addDaysIso(today, 1));
  const [submitting, setSubmitting] = useState(false);

  // Ensure catalog is available (presale may be opened without a loaded plan).
  React.useEffect(() => {
    if (products.length === 0 && warehouseId && isOnline) {
      void loadProducts(warehouseId);
    }
  }, [products.length, warehouseId, isOnline, loadProducts]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) {
      Alert.alert('Búsqueda', 'Escribe al menos 2 caracteres.');
      return;
    }
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate para buscar clientes.');
      return;
    }
    setSearching(true);
    try {
      const res = await searchOffrouteEntities(q);
      setResults(res);
    } catch {
      Alert.alert('Error', 'No se pudo buscar. Intenta de nuevo.');
    } finally {
      setSearching(false);
    }
  }, [query, isOnline]);

  function handleSelectResult(r: OffrouteSearchResult) {
    if (r.entityType === 'lead' && !PRESALE_LEAD_SUPPORTED) {
      Alert.alert(
        'Prospecto no permitido',
        'Este prospecto debe convertirse a cliente antes de hacer preventa.',
      );
      return;
    }
    setSelected(r);
    setResults([]);
    setQuery('');
  }

  const addLine = useCallback((line: SaleLineItem) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === line.productId);
      if (existing) {
        return prev.map((l) => (l.productId === line.productId ? { ...l, qty: l.qty + line.qty } : l));
      }
      return [...prev, line];
    });
  }, []);

  function removeLine(productId: number) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  const total = computeCartTotal(cart);
  const partnerId = selected?.entityType === 'customer'
    ? (selected.partnerId ?? selected.id)
    : (selected?.partnerId ?? null);
  const leadId = selected?.entityType === 'lead' ? selected.id : null;

  async function handleConfirm() {
    if (submitting) return;
    const built = buildPresalePayload(
      {
        operationId: makeOperationId(),
        partnerId,
        leadId,
        commitmentDate: deliveryDate,
        cart,
        employeeId,
        companyId,
        routePlanId: planId,
      },
      { todayIso: today, allowLead: PRESALE_LEAD_SUPPORTED },
    );
    if (!built.ok) {
      Alert.alert('Falta información', built.reason);
      return;
    }
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate para registrar la preventa.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await createPresale(built.payload);
      const folio = res.name || `#${res.saleOrderId ?? ''}`;
      // Limpiar formulario/carrito local tras éxito.
      setCart([]);
      setSelected(null);
      setDeliveryDate(addDaysIso(today, 1));
      Alert.alert(
        'Preventa creada',
        `Preventa creada como cotización ${folio}.`,
        [{ text: 'Volver a Ruta', onPress: () => router.back() }],
      );
    } catch (err) {
      if (err instanceof PresaleNotEnabledError) {
        Alert.alert(
          'Preventa no disponible',
          'La preventa está pendiente de habilitar en el backend. No se creó ninguna cotización.',
        );
      } else {
        Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo registrar la preventa.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Preventa" showBack />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {!PRESALE_BACKEND_ENABLED && (
          <View style={styles.warnBanner}>
            <Text style={styles.warnTitle}>⚠️ Preventa pendiente de habilitar en backend</Text>
            <Text style={styles.warnBody}>
              Puedes preparar la preventa, pero el registro de la cotización se
              activará cuando el backend esté listo. No se simula éxito.
            </Text>
          </View>
        )}

        {/* Step 1: cliente */}
        <Card>
          <Text style={styles.stepTitle}>1 · Cliente</Text>
          {selected ? (
            <View style={styles.selectedRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.selectedName}>{selected.name}</Text>
                <Badge label={selected.entityType === 'lead' ? 'Prospecto' : 'Cliente'} variant={selected.entityType === 'lead' ? 'orange' : 'green'} />
              </View>
              <TouchableOpacity onPress={() => setSelected(null)}><Text style={styles.changeLink}>Cambiar</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar cliente…"
                  placeholderTextColor={colors.textDim}
                  onSubmitEditing={runSearch}
                  returnKeyType="search"
                />
                <Button label={searching ? '…' : 'Buscar'} variant="primary" onPress={runSearch} disabled={searching} />
              </View>
              {results.map((r) => (
                <TouchableOpacity key={`${r.entityType}-${r.id}`} style={styles.resultRow} onPress={() => handleSelectResult(r)}>
                  <Text style={styles.resultName} numberOfLines={1}>{r.name}</Text>
                  <Badge label={r.entityType === 'lead' ? 'Prospecto' : 'Cliente'} variant={r.entityType === 'lead' ? 'orange' : 'dim'} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </Card>

        {/* Step 2: productos */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.stepTitle}>2 · Productos</Text>
            <TouchableOpacity
              onPress={() => {
                if (!selected) { Alert.alert('Selecciona cliente', 'Primero elige el cliente.'); return; }
                setPickerOpen(true);
              }}
            >
              <Text style={styles.addLink}>+ Agregar</Text>
            </TouchableOpacity>
          </View>
          {cart.length === 0 ? (
            <Text style={styles.dim}>Sin productos. Toca "Agregar".</Text>
          ) : (
            cart.map((l) => (
              <View key={l.productId} style={styles.cartRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cartName} numberOfLines={1}>{l.productName}</Text>
                  <Text style={styles.cartMeta}>{l.qty} × {formatCurrency(l.price)}</Text>
                </View>
                <Text style={styles.cartLineTotal}>{formatCurrency(l.price * l.qty)}</Text>
                <TouchableOpacity onPress={() => removeLine(l.productId)}><Text style={styles.removeX}>✕</Text></TouchableOpacity>
              </View>
            ))
          )}
          {cart.length > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total (sin IVA)</Text>
              <Text style={styles.totalValue}>{formatCurrency(total)}</Text>
            </View>
          )}
        </Card>

        {/* Step 3: fecha de entrega */}
        <Card>
          <Text style={styles.stepTitle}>3 · Fecha de entrega</Text>
          <TextInput
            style={styles.dateInput}
            value={deliveryDate}
            onChangeText={setDeliveryDate}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={colors.textDim}
            keyboardType="numbers-and-punctuation"
          />
          <View style={styles.quickDates}>
            {[1, 3, 7].map((d) => (
              <TouchableOpacity key={d} style={styles.quickChip} onPress={() => setDeliveryDate(addDaysIso(today, d))}>
                <Text style={styles.quickChipText}>+{d}d</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <Button
          label={submitting ? 'Registrando…' : 'Confirmar preventa'}
          variant="success"
          onPress={handleConfirm}
          fullWidth
          disabled={submitting || !selected || cart.length === 0}
          loading={submitting}
          style={{ marginTop: 6 }}
        />
        <Text style={styles.footNote}>
          La preventa NO cobra, NO descuenta inventario de ruta y NO entra a liquidación.
        </Text>
      </ScrollView>

      {selected && (
        <ProductPicker
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          existingProductIds={cart.map((l) => l.productId)}
          partnerId={partnerId ?? undefined}
          onAddLine={addLine}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100, gap: 12 },
  warnBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: 'rgba(234,179,8,0.08)', borderWidth: 1, borderColor: 'rgba(234,179,8,0.45)',
  },
  warnTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4 },
  warnBody: { fontSize: 12, lineHeight: 17, color: colors.textDim },
  stepTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInput: {
    flex: 1, height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radii.button,
    paddingHorizontal: 12, color: colors.text, backgroundColor: colors.card,
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  resultName: { flex: 1, fontSize: 14, color: colors.text, marginRight: 8 },
  selectedRow: { flexDirection: 'row', alignItems: 'center' },
  selectedName: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 4 },
  changeLink: { fontSize: 13, color: colors.primary, fontWeight: '700' },
  addLink: { fontSize: 14, color: colors.primary, fontWeight: '700' },
  dim: { fontSize: 13, color: colors.textDim },
  cartRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  cartName: { fontSize: 13, fontWeight: '600', color: colors.text },
  cartMeta: { fontSize: 12, color: colors.textDim, marginTop: 2 },
  cartLineTotal: { fontFamily: fonts.monoBold, fontSize: 13, fontWeight: '700', color: colors.text },
  removeX: { fontSize: 16, color: colors.error, paddingHorizontal: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  totalLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  totalValue: { fontFamily: fonts.monoBold, fontSize: 16, fontWeight: '800', color: colors.success },
  dateInput: {
    height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.button,
    paddingHorizontal: 14, color: colors.text, fontFamily: fonts.monoBold, fontSize: 16, backgroundColor: colors.card,
  },
  quickDates: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quickChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radii.button, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  quickChipText: { fontSize: 13, fontWeight: '700', color: colors.text },
  footNote: { fontSize: 11, color: colors.textDim, textAlign: 'center', marginTop: 8, lineHeight: 15 },
});
