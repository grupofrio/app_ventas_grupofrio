/**
 * Sale screen — s-sale in mockup (lines 283-306).
 * Product lines with +/- qty, totals, payment method, mandatory photo.
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useVisitStore } from '../../src/stores/useVisitStore';
import { useProductStore } from '../../src/stores/useProductStore';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { SaveIndicator } from '../../src/components/ui/SaveIndicator';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { useLocationStore } from '../../src/stores/useLocationStore';
import { formatCatalogPrice, formatCurrency } from '../../src/utils/time';
import { takePhoto } from '../../src/services/camera';
import { ProductPicker } from '../../src/components/domain/ProductPicker';
import { shouldSkipStopCheckout } from '../../src/services/virtualStops';
import {
  getEffectiveSalesCompanyId,
  getPartnerPricelistId,
  peekResolvedPartnerPricelistId,
} from '../../src/services/pricelist';
import { resolveImplicitSaleAnalytics } from '../../src/services/saleAnalytics';
import { logInfo } from '../../src/utils/logger';
import { getLeadPartnerId } from '../../src/services/leadVisit';
import { shouldRefreshProductsOnFocus } from '../../src/utils/productLoading';

export default function SaleScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
  const removeStop = useRouteStore((s) => s.removeStop);
  const updateStopState = useRouteStore((s) => s.updateStopState);
  const stop = stops.find((s) => s.id === Number(stopId));
  const companyId = useAuthStore((s) => s.companyId);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const defaultPaymentJournalId = useAuthStore((s) => s.defaultPaymentJournalId);
  const employeeAnalyticPlazaId = useAuthStore((s) => s.employeeAnalyticPlazaId);
  const employeeAnalyticPlazaName = useAuthStore((s) => s.employeeAnalyticPlazaName);
  const products = useProductStore((s) => s.products);
  const isLoadingProducts = useProductStore((s) => s.isLoading);
  const productError = useProductStore((s) => s.error);
  const loadProducts = useProductStore((s) => s.loadProducts);
  // BLD-20260424-LOOP: pasamos productCount y lastSync al guard del
  // useFocusEffect para evitar el loop de /truck_stock (18 reqs en 7s).
  const productCount = useProductStore((s) => s.productCount);
  const productsLastSync = useProductStore((s) => s.lastSync);

  const {
    saleLines, salePaymentMethod, salePhotoTaken,
    updateSaleQty, setSalePayment,
    saleSubtotal, saleTax, saleTotal, saleTotalKg, resetVisit, offrouteVisitId,
  } = useVisitStore();

  const enqueue = useSyncStore((s) => s.enqueue);
  const isOnline = useSyncStore((s) => s.isOnline);
  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);

  const [pickerVisible, setPickerVisible] = React.useState(false);

  useFocusEffect(
    useCallback(() => {
      if (shouldRefreshProductsOnFocus(
        warehouseId,
        isLoadingProducts,
        productCount,
        productsLastSync,
      )) {
        void loadProducts(warehouseId!);
      }
    }, [warehouseId, isLoadingProducts, productCount, productsLastSync, loadProducts])
  );

  if (!stop) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar title="Venta" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>Parada no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  const subtotal = saleSubtotal();
  const tax = saleTax();
  const total = saleTotal();
  const totalKg = saleTotalKg();
  const forecast = stop._koldForecast;

  // V1.2: Stock validation + anti-duplicate
  const { saleConfirmed, hasStockIssues, getStockIssues, lockSaleConfirm } = useVisitStore();
  const stockIssues = getStockIssues();
  const hasStock = !hasStockIssues();
  const implicitAnalytics = resolveImplicitSaleAnalytics({
    employeeAnalyticPlazaId,
  });
  const hasAnalyticSelection = !!implicitAnalytics.analytic_plaza_id && !!implicitAnalytics.analytic_un_id;
  const hasWarehouse = typeof warehouseId === 'number' && warehouseId > 0;
  const canConfirm = saleLines.length > 0 && salePhotoTaken && salePaymentMethod
                     && hasAnalyticSelection && hasWarehouse
                     && hasStock && !saleConfirmed;
  const salePartnerId = getLeadPartnerId(stop) ?? stop.customer_id;

  function setSaleQtyFromText(productId: number, qtyText: string) {
    const digits = qtyText.replace(/\D/g, '');
    updateSaleQty(productId, digits ? Number(digits) : 0);
  }

  async function handleConfirm() {
    if (saleConfirmed) return; // V1.2: Anti double-tap

    if (!hasStock) {
      Alert.alert(
        'Stock insuficiente',
        stockIssues.map((i) =>
          `${i.name}: pides ${i.requested}, disponible ${i.available}`
        ).join('\n'),
      );
      return;
    }

    if (!canConfirm) {
      const missing = [];
      if (saleLines.length === 0) missing.push('productos');
      if (!salePhotoTaken) missing.push('foto de entrega');
      if (!salePaymentMethod) missing.push('metodo de pago');
      if (!implicitAnalytics.analytic_plaza_id) missing.push('plaza del empleado');
      if (!hasWarehouse) missing.push('almacén del empleado');
      Alert.alert('Faltan datos', `Completa: ${missing.join(', ')}`);
      return;
    }

    if (!stop) return;
    if (stop._entityType === 'lead' && !getLeadPartnerId(stop)) {
      Alert.alert('Lead no vendible', 'Primero completa Datos para crear o enlazar el contacto del lead.');
      return;
    }

    // V1.2: Lock to prevent duplicate
    lockSaleConfirm();

    // BLD-20260408-P0: Detect off-route sales (virtual stops have negative IDs)
    const isOffRoute = stop.id < 0;
    const effectiveCompanyId = getEffectiveSalesCompanyId(companyId);
    // Only send a pricelist_id when we have one confirmed from the partner's own
    // data (source: partner_field or get_records). Company fallback
    // is cached as null to prevent "Empresas incompatibles" when the partner
    // belongs to a different Odoo company — Odoo assigns its default server-side.
    const stopPricelistId = typeof stop._pricelistId === 'number' && stop._pricelistId > 0
      ? stop._pricelistId
      : null;
    if (!stopPricelistId) {
      await getPartnerPricelistId(salePartnerId, { companyId: effectiveCompanyId });
    }
    const pricelistId =
      stopPricelistId ??
      peekResolvedPartnerPricelistId(salePartnerId, { companyId: effectiveCompanyId });

    // Create sale order payload with idempotency key
    const payload = {
      partner_id: salePartnerId,
      stop_id: isOffRoute ? null : stop.id, // Don't send negative virtual IDs to backend
      warehouse_id: warehouseId ?? null,
      pricelist_id: pricelistId ?? null,
      analytic_plaza_id: implicitAnalytics.analytic_plaza_id,
      analytic_un_id: implicitAnalytics.analytic_un_id,
      analytic_distribution: implicitAnalytics.analytic_distribution,
      lines: saleLines.map((l) => ({
        product_id: l.productId,
        quantity: l.qty,
        discount: 0,
      })),
    };

    logInfo('general', 'sale_enqueue_payload', {
      partner_id: salePartnerId,
      stop_id: payload.stop_id,
      warehouse_id: payload.warehouse_id,
      pricelist_id: payload.pricelist_id,
      analytic_plaza_id: payload.analytic_plaza_id,
      analytic_un_id: payload.analytic_un_id,
      employee_analytic_plaza_id: employeeAnalyticPlazaId,
      employee_analytic_plaza_name: employeeAnalyticPlazaName,
      line_count: payload.lines.length,
      company_id: companyId,
      effective_company_id: effectiveCompanyId,
    });

    // Enqueue and remember the real queue item id. That same id becomes the
    // operation_id sent to backend, and checkout can use it to avoid closing
    // the stop before the sale exists server-side.
    const saleSyncId = enqueue('sale_order', payload);
    useVisitStore.setState({ saleOperationId: saleSyncId });

    if (salePaymentMethod === 'cash') {
      enqueue('payment', {
        partner_id: salePartnerId,
        stop_id: isOffRoute ? null : stop.id,
        amount: total,
        journal_id: defaultPaymentJournalId,
        reference: 'Venta efectivo',
      }, { dependsOn: [saleSyncId] });
    }

    // V1.2: Deduct local inventory immediately
    const updateLocalStock = useProductStore.getState().updateLocalStock;
    saleLines.forEach((l) => updateLocalStock(l.productId, -l.qty));

    if (shouldSkipStopCheckout(stop.id)) {
      if (offrouteVisitId) {
        // Enqueue with dependency so the backend receives the close ONLY after
        // the sale order is confirmed. Calling closeOffrouteVisit directly while
        // the sale is still queued caused the order to stay as a quotation with
        // inventory already decremented (partial action_confirm on backend).
        enqueue('offroute_visit_close', {
          visit_id: offrouteVisitId,
          result_status: 'sale' as const,
          latitude: latitude || 0,
          longitude: longitude || 0,
          timestamp: Date.now(),
        }, { dependsOn: [saleSyncId] });
      }
      updateStopState(stop.id, 'done');
      resetVisit();
      router.replace('/(tabs)/route' as never);
      return;
    }

    router.push(`/checkout/${stop.id}` as never);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Nueva Venta" showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* Customer + forecast hint */}
        <Text style={styles.customerName}>{stop.customer_name}</Text>
        {forecast && (
          <Text style={styles.forecastHint}>
            Sugerido KoldDemand: {forecast.predicted_kg.toFixed(0)} kg
          </Text>
        )}

        {/* Product lines */}
        {saleLines.length === 0 ? (
          <View style={styles.emptyProducts}>
            <Text style={typography.dim}>Agrega productos a la venta</Text>
            <Text style={[typography.dimSmall, { marginTop: 4 }]}>
              F4: Integración con catálogo de productos
            </Text>
          </View>
        ) : (
          saleLines.map((line) => (
            <View key={line.productId} style={styles.productLine}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{line.productName}</Text>
                <Text style={styles.productInfo}>
                  {formatCatalogPrice(line.price)} · Stock: {line.stock}
                </Text>
              </View>
              <View style={styles.qtyControls}>
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateSaleQty(line.productId, line.qty - 1)}
                >
                  <Text style={styles.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <TextInput
                  accessibilityLabel={`Piezas de ${line.productName}`}
                  style={styles.qtyValue}
                  value={String(line.qty)}
                  onChangeText={(text) => setSaleQtyFromText(line.productId, text)}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  selectTextOnFocus
                  maxLength={4}
                />
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateSaleQty(line.productId, line.qty + 1)}
                >
                  <Text style={styles.qtyBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        {/* Product picker */}
        {isLoadingProducts && saleLines.length === 0 && (
          <View style={styles.emptyProducts}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[typography.dim, { marginTop: 8 }]}>Cargando productos...</Text>
          </View>
        )}
        {!isLoadingProducts && productError && products.length === 0 && (
          <View style={styles.emptyProducts}>
            <Text style={typography.dim}>{productError}</Text>
          </View>
        )}
        <Button
          label="+ Agregar producto"
          variant="secondary"
          small
          fullWidth
          onPress={() => setPickerVisible(true)}
          disabled={isLoadingProducts || (!!productError && products.length === 0)}
          style={{ marginVertical: 10 }}
        />
        <ProductPicker
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          existingProductIds={saleLines.map((l) => l.productId)}
          partnerId={salePartnerId}
          pricelistId={stop._pricelistId}
        />

        {/* Totals card */}
        <Card style={styles.totalsCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatCurrency(subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Impuestos</Text>
            <Text style={styles.totalValue}>{formatCurrency(tax)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total kg</Text>
            <Text style={[styles.totalValue, { color: colors.primary }]}>
              {totalKg.toFixed(1)} kg
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.grandTotalLabel}>TOTAL</Text>
            <Text style={styles.grandTotalValue}>{formatCurrency(total)}</Text>
          </View>
        </Card>

        {/* Payment method */}
        <View style={styles.paymentRow}>
          <Button
            label="💵 Efectivo"
            variant={salePaymentMethod === 'cash' ? 'primary' : 'secondary'}
            onPress={() => setSalePayment('cash')}
            style={{ flex: 1 }}
          />
          <Button
            label="💳 Crédito"
            variant={salePaymentMethod === 'credit' ? 'primary' : 'secondary'}
            onPress={() => setSalePayment('credit')}
            style={{ flex: 1 }}
          />
        </View>

        <View style={styles.analyticsInfo}>
          <Text style={styles.sectionTitle}>Analiticas</Text>
          <Text style={styles.analyticsInfoText}>
            Plaza: {employeeAnalyticPlazaName || 'Sin configurar en empleado'}
          </Text>
          <Text style={styles.analyticsInfoText}>
            Unidad de negocio: CEDIS
          </Text>
        </View>

        {/* Mandatory photo */}
        <Text style={styles.sectionTitle}>📸 Foto de entrega (obligatoria)</Text>
        {salePhotoTaken ? (
          <View style={styles.photoDone}>
            <Text style={{ fontSize: 28 }}>📸</Text>
            <Text style={{ fontSize: 12, color: colors.success, fontWeight: '600' }}>
              ✓ Foto capturada
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.photoReq}
            onPress={async () => {
              const photo = await takePhoto();
              if (photo) {
                useVisitStore.getState().setSalePhoto(photo.localUri);
              } else {
                Alert.alert('Foto requerida', 'No se pudo capturar la foto. Intenta de nuevo.');
              }
            }}
          >
            <Text style={{ fontSize: 32 }}>📸</Text>
            <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '600' }}>
              Tomar foto de entrega
            </Text>
            <Text style={{ fontSize: 10, color: colors.textDim }}>
              Requerida para confirmar el pedido
            </Text>
          </TouchableOpacity>
        )}

        {/* V1.2: Stock issues warning */}
        {stockIssues.length > 0 && (
          <View style={styles.stockWarning}>
            <Text style={styles.stockWarningTitle}>⚠️ Stock insuficiente</Text>
            {stockIssues.map((issue) => (
              <Text key={issue.productId} style={styles.stockWarningLine}>
                {issue.name}: pides {issue.requested}, disponible {issue.available}
              </Text>
            ))}
          </View>
        )}

        {/* V1.2.1: Save status indicator */}
        {saleConfirmed && (
          <SaveIndicator status="saved_local" />
        )}

        {/* Confirm button */}
        <Button
          label={saleConfirmed ? '✓ Pedido Guardado' : '✓ Confirmar Pedido'}
          onPress={handleConfirm}
          fullWidth
          disabled={saleConfirmed}
          loading={false}
          style={{ marginTop: saleConfirmed ? 0 : 14 }}
        />

        {/* Validation feedback */}
        {!canConfirm && saleLines.length > 0 && !saleConfirmed && (
          <Text style={styles.validationHint}>
            {!hasStock ? '⚠️ Ajusta cantidades al stock' : ''}
            {hasStock && !salePhotoTaken ? '📸 Toma la foto' : ''}
            {hasStock && salePhotoTaken && !salePaymentMethod ? '💰 Selecciona pago' : ''}
            {hasStock && salePhotoTaken && salePaymentMethod && !implicitAnalytics.analytic_plaza_id ? '📍 Configura la plaza del empleado' : ''}
            {hasStock && salePhotoTaken && salePaymentMethod && implicitAnalytics.analytic_plaza_id && !hasWarehouse ? '🏬 Configura el almacén del empleado' : ''}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  customerName: { fontSize: 12, color: colors.textDim, marginBottom: 2 },
  forecastHint: { fontSize: 11, color: colors.primary, marginBottom: 14 },
  emptyProducts: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 20,
    alignItems: 'center',
    marginBottom: 10,
  },
  // Product line (.pl in mockup)
  productLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.cardLighter,
    borderRadius: radii.button,
    marginBottom: 5,
  },
  productName: { fontSize: 13, fontWeight: '600', color: colors.text },
  productInfo: { fontSize: 11, color: colors.textDim },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 16, color: colors.text },
  qtyValue: {
    fontFamily: fonts.monoBold,
    fontSize: 15, fontWeight: '700', color: colors.text,
    minWidth: 48, height: 34, textAlign: 'center',
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderLight,
    borderRadius: radii.button,
    paddingHorizontal: 6, paddingVertical: 0,
  },
  // Totals
  totalsCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 14,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  totalLabel: { fontSize: 12, color: colors.textDim },
  totalValue: { fontFamily: fonts.monoBold, fontSize: 13, fontWeight: '700', color: colors.text },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 6 },
  grandTotalLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  grandTotalValue: {
    fontFamily: fonts.monoBold,
    fontSize: 22, fontWeight: '700', color: colors.success,
  },
  // Payment
  paymentRow: { flexDirection: 'row', gap: 6, marginVertical: 10 },
  analyticsInfo: {
    backgroundColor: colors.cardLighter,
    borderRadius: radii.card,
    padding: 12,
    marginBottom: 10,
  },
  analyticsInfoText: {
    fontSize: 12,
    color: colors.text,
    marginTop: 4,
  },
  // Photo
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  photoReq: {
    backgroundColor: colors.cardLighter,
    borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(37,99,235,0.3)',
    borderRadius: radii.card, padding: 28, alignItems: 'center', gap: 6,
  },
  photoDone: {
    backgroundColor: colors.cardLighter,
    borderWidth: 2, borderColor: colors.success,
    borderRadius: radii.card, padding: 14, alignItems: 'center', gap: 4,
  },
  validationHint: {
    fontSize: 11, color: colors.warning, textAlign: 'center', marginTop: 8,
  },
  // V1.2
  stockWarning: {
    backgroundColor: colors.errorAlpha08, borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.15)', borderRadius: radii.button,
    padding: 10, marginTop: 8,
  },
  stockWarningTitle: {
    fontSize: 12, fontWeight: '700', color: colors.error, marginBottom: 4,
  },
  stockWarningLine: {
    fontSize: 11, color: colors.error, lineHeight: 16,
  },
});
