import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { AlertBanner } from '../../src/components/ui/AlertBanner';
import { GiftProductPicker } from '../../src/components/domain/GiftProductPicker';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useProductStore } from '../../src/stores/useProductStore';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { shouldRefreshProductsOnFocus } from '../../src/utils/productLoading';
import {
  buildGiftPayload,
  getGiftSubmitIssues,
  GiftDraftLine,
  toGiftPayloadLines,
} from '../../src/services/giftPayload';
import { createGift } from '../../src/services/gfSalesOps';
import { getLeadPartnerId } from '../../src/services/leadVisit';
import { findFreshStockIssues } from '../../src/services/saleStockValidation';

interface EditableGiftLine extends GiftDraftLine {
  productName: string;
}

function makeLineKey(): string {
  return `gift-line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeAttemptId(): string {
  return `gift-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getIssueMessage(issue: string): string {
  switch (issue) {
    case 'missing_partner':
      return 'Completa Datos para crear o enlazar el contacto antes de registrar regalos.';
    case 'missing_mobile_location':
      return 'No se encontró la ubicación móvil activa de la unidad. Contacta al administrador.';
    case 'missing_analytic_account':
      return 'El empleado no tiene plaza analítica configurada.';
    case 'duplicate_products':
      return 'No repitas el mismo producto en más de una línea.';
    case 'no_valid_lines':
      return 'Agrega al menos una línea con producto y cantidad mayor a 0.';
    default:
      return 'Revisa la información antes de continuar.';
  }
}

export default function GiftScreen() {
  const { stopId, from } = useLocalSearchParams<{ stopId: string; from?: string }>();
  const router = useRouter();
  const plan = useRouteStore((s) => s.plan);
  const stop = useRouteStore((s) => s.stops.find((item) => item.id === Number(stopId)));
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const employeeAnalyticPlazaId = useAuthStore((s) => s.employeeAnalyticPlazaId);
  const employeeAnalyticPlazaName = useAuthStore((s) => s.employeeAnalyticPlazaName);
  const products = useProductStore((s) => s.products);
  const isLoadingProducts = useProductStore((s) => s.isLoading);
  const productError = useProductStore((s) => s.error);
  const loadProducts = useProductStore((s) => s.loadProducts);
  const productCount = useProductStore((s) => s.productCount);
  const productsLastSync = useProductStore((s) => s.lastSync);

  const [lines, setLines] = useState<EditableGiftLine[]>([
    { key: makeLineKey(), productId: null, productName: '', qtyText: '' },
  ]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pickerLineKey, setPickerLineKey] = useState<string | null>(null);

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
    }, [warehouseId, isLoadingProducts, productCount, productsLastSync, loadProducts]),
  );

  const partnerId = useMemo(() => {
    if (!stop) return null;
    if (stop._entityType === 'lead') return getLeadPartnerId(stop);
    return stop.customer_id;
  }, [stop]);

  const mobileLocationId = plan?.mobile_location_id ?? null;
  const draftLines = useMemo<GiftDraftLine[]>(
    () => lines.map(({ key, productId, qtyText }) => ({ key, productId, qtyText })),
    [lines],
  );
  const submitIssues = useMemo(() => (
    getGiftSubmitIssues({
      lines: draftLines,
      partnerId,
      mobileLocationId,
      analyticAccountId: employeeAnalyticPlazaId,
    })
  ), [draftLines, employeeAnalyticPlazaId, mobileLocationId, partnerId]);
  const payloadLines = useMemo(() => toGiftPayloadLines(draftLines), [draftLines]);
  const canSubmit = submitIssues.length === 0 && !submitting;

  const activePickerLine = pickerLineKey
    ? lines.find((line) => line.key === pickerLineKey) ?? null
    : null;
  const excludedProductIds = activePickerLine
    ? lines
        .filter((line) => line.key !== activePickerLine.key && !!line.productId)
        .map((line) => line.productId as number)
    : [];

  if (!stop) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Regalo / Muestra" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>Parada no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  function updateLine(lineKey: string, patch: Partial<EditableGiftLine>) {
    setLines((prev) => prev.map((line) => (
      line.key === lineKey ? { ...line, ...patch } : line
    )));
  }

  function removeLine(lineKey: string) {
    setLines((prev) => (
      prev.length === 1
        ? prev
        : prev.filter((line) => line.key !== lineKey)
    ));
  }

  function addLine() {
    setLines((prev) => [...prev, {
      key: makeLineKey(),
      productId: null,
      productName: '',
      qtyText: '',
    }]);
  }

  async function handleSubmit() {
    if (!stop) return;

    if (!canSubmit || !partnerId || !mobileLocationId || !employeeAnalyticPlazaId) {
      if (submitIssues.length > 0) {
        Alert.alert('Faltan datos', getIssueMessage(submitIssues[0]));
      }
      return;
    }

    // P2: no regalar más de lo disponible en la unidad. Reusa el validador de
    // stock fresco de venta (P0) — no duplica lógica. qty<=0/NaN ya lo descarta
    // toGiftPayloadLines; aquí cubrimos qty > disponible.
    const stockIssues = findFreshStockIssues(
      payloadLines.map((l) => ({
        productId: l.productId,
        productName: products.find((p) => p.id === l.productId)?.name ?? `#${l.productId}`,
        qty: l.qty,
      })),
      products,
    );
    if (stockIssues.length > 0) {
      Alert.alert(
        'Stock insuficiente',
        stockIssues.map((i) =>
          i.kind === 'invalid_qty'
            ? `${i.name}: cantidad inválida`
            : `${i.name}: regalas ${i.requested}, disponible ${i.available}`,
        ).join('\n'),
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload = buildGiftPayload({
        analyticAccountId: employeeAnalyticPlazaId,
        idempotencyKey: makeAttemptId(),
        mobileLocationId,
        partnerId,
        visitLineId: stop.visit_line_id ?? null,
        lines: payloadLines,
        notes,
      });

      const result = await createGift(payload);
      const target = from === 'checkin'
        ? `/checkin/${stop.id}?giftSuccess=${encodeURIComponent(result.userMessage)}`
        : `/stop/${stop.id}?giftSuccess=${encodeURIComponent(result.userMessage)}`;
      router.replace(target as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar el regalo.';
      Alert.alert('Regalo rechazado', message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Regalo / Muestra" showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.headerTitle}>{stop.customer_name}</Text>
          <Text style={styles.headerSubtitle}>
            Registra producto entregado sin cobro. El movimiento sale de la unidad móvil y baja a merma de la van.
          </Text>
        </Card>

        {!partnerId ? (
          <AlertBanner
            variant="warning"
            icon="⚠️"
            message={getIssueMessage('missing_partner')}
          />
        ) : null}
        {!mobileLocationId ? (
          <AlertBanner
            variant="critical"
            icon="📍"
            message={getIssueMessage('missing_mobile_location')}
          />
        ) : null}
        {!employeeAnalyticPlazaId ? (
          <AlertBanner
            variant="critical"
            icon="🏢"
            message={getIssueMessage('missing_analytic_account')}
          />
        ) : null}

        <Text style={styles.sectionTitle}>PRODUCTOS</Text>
        {isLoadingProducts && products.length === 0 ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[typography.dim, { marginTop: 8 }]}>Cargando productos...</Text>
          </View>
        ) : null}
        {!isLoadingProducts && productError && products.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={typography.dim}>{productError}</Text>
          </View>
        ) : null}

        {lines.map((line, index) => (
          <View key={line.key} style={styles.lineCard}>
            <View style={styles.lineHeader}>
              <Text style={styles.lineTitle}>Línea {index + 1}</Text>
              {lines.length > 1 ? (
                <TouchableOpacity onPress={() => removeLine(line.key)} activeOpacity={0.8}>
                  <Text style={styles.removeText}>Quitar</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={styles.inputLabel}>PRODUCTO</Text>
            <TouchableOpacity
              style={styles.selector}
              activeOpacity={0.8}
              onPress={() => setPickerLineKey(line.key)}
              disabled={isLoadingProducts || (!!productError && products.length === 0)}
            >
              <Text style={line.productName ? styles.selectorValue : styles.selectorPlaceholder}>
                {line.productName || 'Selecciona un producto'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.inputLabel}>CANTIDAD</Text>
            <TextInput
              style={styles.qtyInput}
              value={line.qtyText}
              onChangeText={(qtyText) => updateLine(line.key, { qtyText })}
              placeholder="0"
              placeholderTextColor={colors.textDim}
              keyboardType="decimal-pad"
            />
          </View>
        ))}

        <Button
          label="+ Agregar línea"
          variant="secondary"
          small
          fullWidth
          onPress={addLine}
          style={{ marginTop: 10 }}
        />

        <Text style={styles.sectionTitle}>OBSERVACIONES</Text>
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder="Notas opcionales..."
          placeholderTextColor={colors.textDim}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />

        <View style={styles.analyticsInfo}>
          <Text style={styles.analyticsTitle}>Sucursal activa</Text>
          <Text style={styles.analyticsValue}>
            {employeeAnalyticPlazaName || 'Sin plaza configurada'}
          </Text>
          <Text style={styles.analyticsMeta}>
            Ubicación móvil: {mobileLocationId || 'No disponible'}
          </Text>
          <Text style={styles.analyticsMeta}>
            Visit line: {stop.visit_line_id || 'No disponible'}
          </Text>
        </View>

        {submitIssues.includes('duplicate_products') ? (
          <Text style={styles.validationHint}>{getIssueMessage('duplicate_products')}</Text>
        ) : null}
        {submitIssues.includes('no_valid_lines') ? (
          <Text style={styles.validationHint}>{getIssueMessage('no_valid_lines')}</Text>
        ) : null}

        <Button
          label="Registrar Regalo"
          onPress={handleSubmit}
          fullWidth
          loading={submitting}
          disabled={!canSubmit}
          style={{ marginTop: 14 }}
        />
      </ScrollView>

      <GiftProductPicker
        visible={pickerLineKey != null}
        excludedProductIds={excludedProductIds}
        onClose={() => setPickerLineKey(null)}
        onSelect={(product) => {
          if (!pickerLineKey) return;
          updateLine(pickerLineKey, {
            productId: product.id,
            productName: product.name,
          });
          setPickerLineKey(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  headerTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 12, color: colors.textDim, marginTop: 6, lineHeight: 18 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: colors.textDim,
    marginTop: 16,
    marginBottom: 8,
  },
  lineCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 8,
  },
  lineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  lineTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  removeText: { fontSize: 12, color: colors.error, fontWeight: '600' },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: colors.textDim,
    marginTop: 10,
    marginBottom: 5,
  },
  selector: {
    backgroundColor: colors.cardLighter,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  selectorPlaceholder: { fontSize: 14, color: colors.textDim },
  selectorValue: { fontSize: 14, color: colors.text, fontWeight: '600' },
  qtyInput: {
    backgroundColor: colors.cardLighter,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontFamily: fonts.monoBold,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  notesInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    minHeight: 84,
  },
  analyticsInfo: {
    backgroundColor: colors.cardLighter,
    borderRadius: radii.card,
    padding: 12,
    marginTop: 14,
  },
  analyticsTitle: {
    fontSize: 12,
    color: colors.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  analyticsValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 4,
  },
  analyticsMeta: {
    fontSize: 11,
    color: colors.textDim,
    marginTop: 4,
  },
  validationHint: {
    fontSize: 11,
    color: colors.warning,
    textAlign: 'center',
    marginTop: 8,
  },
  emptyState: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 20,
    alignItems: 'center',
    marginBottom: 10,
  },
});
