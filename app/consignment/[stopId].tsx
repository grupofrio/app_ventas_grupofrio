/**
 * Consignación screen — vive dentro del cliente (/stop/[id] → "📦 Consignación").
 *
 * - Sin consignación activa → CREAR (ProductPicker + cantidad objetivo).
 * - Con consignación activa → VISITA (capturar existencia física; preliminar
 *   vendido/cobro/resurtido) y opción de CERRAR.
 * - Backend es fuente de verdad (inventario, venta/cobro, resurtido, cierre).
 * - Solo clientes de alta (no leads — gateado desde /stop/[id]).
 * - Online-first; sin cola offline → bloquea si no hay conexión.
 * - NO simula éxito. Carrito local (no contamina venta activa).
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { ProductPicker } from '../../src/components/domain/ProductPicker';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { fonts } from '../../src/theme/typography';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useProductStore } from '../../src/stores/useProductStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import type { SaleLineItem } from '../../src/stores/useVisitStore';
import { formatCurrency } from '../../src/utils/time';
import type { ActiveConsignment, ConsignmentPaymentMethod } from '../../src/types/consignment';
import {
  getActiveConsignment, createConsignment, visitConsignment, closeConsignment,
  CONSIGNMENT_BACKEND_CONFIRMED,
} from '../../src/services/consignment';
import {
  readCachedConsignment, writeCachedConsignment, canMutateConsignment,
} from '../../src/services/consignmentCache';
import {
  computeLineCalc, computeVisitTotals, computeConsignedValue,
  cartToCreateLines, validateCreateLines, buildCountLines,
  consignmentPaymentLabel, computeReturnTotal,
} from '../../src/services/consignmentLogic';
import { OperationGate } from '../../src/components/OperationGate';
import { consignmentOfflineBlockMessage } from '../../src/services/secondaryFlowCopy';
import { isSessionExpiredError } from '../../src/services/sessionError';
import { findFreshStockIssues } from '../../src/services/saleStockValidation';

function makeOperationId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ConsignmentScreenInner() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
  const stop = stops.find((s) => s.id === Number(stopId));
  const planId = useRouteStore((s) => s.plan?.plan_id ?? null);
  const mobileLocationId = useRouteStore((s) => s.plan?.mobile_location_id ?? null);
  const employeeId = useAuthStore((s) => s.employeeId);
  const companyId = useAuthStore((s) => s.companyId);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const logout = useAuthStore((s) => s.logout);
  const isOnline = useSyncStore((s) => s.isOnline);
  const products = useProductStore((s) => s.products);
  const loadProducts = useProductStore((s) => s.loadProducts);

  const partnerId = stop?._partnerId ?? stop?.customer_id ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveConsignment | null>(null);
  // Perf Fase 2D-1: cuando la consignación mostrada viene del caché de lectura
  // (offline o fallback de error), marcarlo para banner + bloquear mutaciones.
  const [fromCache, setFromCache] = useState(false);
  const canMutate = canMutateConsignment(isOnline);

  // CREATE mode
  const [cart, setCart] = useState<SaleLineItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // VISIT / CLOSE mode
  const [physical, setPhysical] = useState<Record<number, string>>({});
  const [closing, setClosing] = useState(false); // toggle: visita vs cierre
  const paymentMethod: ConsignmentPaymentMethod = 'cash';
  const [submitting, setSubmitting] = useState(false);

  // P1: si la API responde sesión expirada, ofrecer re-login en vez de dejar
  // al vendedor atrapado. No borra datos sin confirmación (logout es explícito).
  const promptReLogin = useCallback(() => {
    Alert.alert(
      'Sesión expirada',
      'Tu sesión caducó. Vuelve a iniciar sesión para continuar.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Volver a iniciar sesión', onPress: () => { void logout(); } },
      ],
    );
  }, [logout]);

  const handleApiError = useCallback((err: unknown, fallback: string) => {
    if (isSessionExpiredError(err)) {
      promptReLogin();
      return;
    }
    Alert.alert('Error', err instanceof Error ? err.message : fallback);
  }, [promptReLogin]);

  const fetchActive = useCallback(async () => {
    if (!partnerId) { setError('Cliente inválido.'); setLoading(false); return; }
    // Perf Fase 2D-1: sin red → intentar lectura cacheada (read-only).
    if (!isOnline) {
      const cached = await readCachedConsignment(partnerId);
      if (cached) { setActive(cached.consignment); setFromCache(true); }
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const a = await getActiveConsignment(partnerId, companyId);
      setActive(a);
      setFromCache(false);
      // Read-through: guardar la consignación (o borrarla si ya no hay) para
      // poder mostrarla offline en una visita posterior sin señal.
      void writeCachedConsignment(partnerId, a);
    } catch (err) {
      // P1: si /my-active responde sesión expirada, ofrecer re-login (igual que
      // las mutaciones) en vez de dejar solo "Reintentar". Errores normales
      // conservan el botón de reintento.
      if (isSessionExpiredError(err)) {
        setError('Sesión expirada. Vuelve a iniciar sesión.');
        promptReLogin();
      } else {
        // Fallback: si la lectura falla pero hay caché válida, mostrarla en
        // modo lectura en vez de dejar al vendedor sin nada.
        const cached = await readCachedConsignment(partnerId);
        if (cached) {
          setActive(cached.consignment);
          setFromCache(true);
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : 'No se pudo consultar la consignación.');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [partnerId, isOnline, companyId, promptReLogin]);

  React.useEffect(() => { void fetchActive(); }, [fetchActive]);
  React.useEffect(() => {
    if (products.length === 0 && warehouseId && isOnline) void loadProducts(warehouseId);
  }, [products.length, warehouseId, isOnline, loadProducts]);

  const addLine = useCallback((line: SaleLineItem) => {
    setCart((prev) => {
      const ex = prev.find((l) => l.productId === line.productId);
      if (ex) return prev.map((l) => (l.productId === line.productId ? { ...l, qty: l.qty + line.qty } : l));
      return [...prev, line];
    });
  }, []);

  // ── CREATE ────────────────────────────────────────────────────────────────
  function runCreate() {
    if (submitting || !partnerId) return;
    const v = validateCreateLines(cart);
    if (!v.ok) { Alert.alert('Falta información', v.reason); return; }
    // P2: no consignar más de lo disponible en la unidad. Reusa el validador de
    // stock fresco (P0). Solo en CREATE — visit/close los recalcula el backend.
    const stockIssues = findFreshStockIssues(cart, products);
    if (stockIssues.length > 0) {
      Alert.alert(
        'Stock insuficiente',
        stockIssues.map((i) =>
          i.kind === 'invalid_qty'
            ? `${i.name}: cantidad inválida`
            : `${i.name}: objetivo ${i.requested}, disponible ${i.available}`,
        ).join('\n'),
      );
      return;
    }
    if (!isOnline) { const m = consignmentOfflineBlockMessage(); Alert.alert(m.title, m.body); return; }
    setSubmitting(true);
    (async () => {
      try {
        const res = await createConsignment({
          partnerId,
          companyId,
          employeeId,
          routePlanId: planId,
          mobileLocationId,
          vehicleId: null, // no disponible en el plan actual
          lines: v.lines,
        });
        const c = res.consignment;
        Alert.alert(res.message || 'Consignación creada', c?.name ? `Folio ${c.name}.` : 'Registrada.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } catch (err) {
        handleApiError(err, 'No se pudo crear la consignación.');
      } finally {
        setSubmitting(false);
      }
    })();
  }

  function handleCreate() {
    if (submitting || !partnerId) return;
    // Backend necesita route_plan_id O mobile_location_id para saber de dónde
    // bajar inventario (apply_inventory=true).
    if (planId == null && mobileLocationId == null) {
      Alert.alert(
        'Sin ruta/ubicación',
        'No hay plan de ruta ni ubicación de unidad. El backend puede no saber de dónde bajar el inventario. ¿Continuar de todos modos?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Continuar', onPress: runCreate },
        ],
      );
      return;
    }
    runCreate();
  }

  // ── VISIT / CLOSE ───────────────────────────────────────────────────────────
  function handleVisitOrClose() {
    if (submitting || !active) return;
    const built = buildCountLines(active.lines, physical);
    if (!built.ok) { Alert.alert('Falta información', built.reason); return; }
    if (!isOnline) { const m = consignmentOfflineBlockMessage(); Alert.alert(m.title, m.body); return; }

    const action = closing ? 'cerrar' : 'registrar la visita de';
    Alert.alert(
      closing ? 'Cerrar consignación' : 'Registrar visita',
      `¿Confirmas ${action} esta consignación? El servidor calcula y cobra el faltante${closing ? ' y registra la devolución del resto' : ' y el resurtido'}. Pago: ${consignmentPaymentLabel(paymentMethod)}.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: () => {
            setSubmitting(true);
            (async () => {
              try {
                const payload = {
                  consignmentId: active.id,
                  operationId: makeOperationId(closing ? 'consign-close' : 'consign-visit'),
                  paymentMethod,
                  counts: built.counts,
                };
                if (closing) {
                  const res = await closeConsignment(payload);
                  Alert.alert(res.message || 'Consignación cerrada', 'El servidor registró el cobro y la devolución.', [
                    { text: 'OK', onPress: () => router.back() },
                  ]);
                } else {
                  const res = await visitConsignment(payload);
                  Alert.alert(res.message || 'Visita registrada', 'El servidor cobró el faltante y resurtió al objetivo.', [
                    { text: 'OK', onPress: () => { setPhysical({}); void fetchActive(); } },
                  ]);
                }
              } catch (err) {
                handleApiError(err, 'No se pudo procesar la consignación.');
              } finally {
                setSubmitting(false);
              }
            })();
          },
        },
      ],
    );
  }

  // ── render guards ───────────────────────────────────────────────────────────
  if (!stop) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Consignación" showBack />
        <View style={styles.center}><Text style={styles.dim}>Cliente no encontrado.</Text></View>
      </SafeAreaView>
    );
  }
  // Perf Fase 2D-1: sin red y SIN consignación cacheada → requiere conexión.
  // Si hay caché de lectura (active != null), caemos al render normal en modo
  // lectura (banner "desde caché" + botones de mutación deshabilitados).
  if (!isOnline && !active) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Consignación" showBack />
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📶</Text>
          <Text style={styles.emptyTitle}>Requiere conexión</Text>
          <Text style={styles.dim}>
            Sin conexión y sin consignación en caché. Crear/visitar/cerrar
            requiere servidor. Abre el cliente con señal para cachear su
            consignación.
          </Text>
        </View>
      </SafeAreaView>
    );
  }
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Consignación" showBack />
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Consignación" showBack />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Button label="Reintentar" variant="primary" onPress={() => void fetchActive()} />
        </View>
      </SafeAreaView>
    );
  }

  // ── CREATE mode (sin consignación activa) ─────────────────────────────────
  if (!active) {
    const consignedValue = computeConsignedValue(cartToCreateLines(cart));
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Nueva consignación" showBack />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          {!CONSIGNMENT_BACKEND_CONFIRMED && (
            <View style={styles.warnBanner}>
              <Text style={styles.warnText}>
                ⚠️ Consignación pendiente de validar con backend. Puedes ver el flujo,
                pero el registro está bloqueado hasta confirmar el contrato.
              </Text>
            </View>
          )}
          <Card>
            <Text style={styles.clientName}>{stop.customer_name}</Text>
            <Text style={styles.dim}>Crea la consignación inicial. Afecta inventario de tu unidad, NO cobra ahora.</Text>
          </Card>

          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.stepTitle}>Productos (cantidad objetivo)</Text>
              <TouchableOpacity onPress={() => setPickerOpen(true)}><Text style={styles.addLink}>+ Agregar</Text></TouchableOpacity>
            </View>
            {cart.length === 0 ? (
              <Text style={styles.dim}>Sin productos. Toca "Agregar".</Text>
            ) : cart.map((l) => (
              <View key={l.productId} style={styles.lineRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName} numberOfLines={1}>{l.productName}</Text>
                  <Text style={styles.lineMeta}>objetivo {l.qty} × {formatCurrency(l.price)}</Text>
                </View>
                <Text style={styles.lineVal}>{formatCurrency(l.price * l.qty)}</Text>
                <TouchableOpacity onPress={() => setCart((p) => p.filter((x) => x.productId !== l.productId))}>
                  <Text style={styles.removeX}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            {cart.length > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Valor consignado</Text>
                <Text style={styles.totalValue}>{formatCurrency(consignedValue)}</Text>
              </View>
            )}
          </Card>

          <Button
            label={submitting ? 'Creando…' : 'Confirmar consignación'}
            variant="success" onPress={handleCreate} fullWidth
            disabled={submitting || cart.length === 0} loading={submitting}
          />
          <Text style={styles.footNote}>La consignación NO cobra al crear; el cobro ocurre en visitas/cierre.</Text>
        </ScrollView>

        <ProductPicker
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          existingProductIds={cart.map((l) => l.productId)}
          partnerId={partnerId ?? undefined}
          onAddLine={addLine}
        />
      </SafeAreaView>
    );
  }

  // ── VISIT / CLOSE mode (consignación activa) ──────────────────────────────
  const calcs = active.lines.map((l) => computeLineCalc(l, parseFloat(physical[l.product_id] ?? '') || 0));
  const totals = computeVisitTotals(calcs);
  const returnTotal = computeReturnTotal(
    active.lines.map((l) => ({ physical_qty: parseFloat(physical[l.product_id] ?? '') || 0 })),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title={closing ? 'Cerrar consignación' : 'Consignación activa'} showBack />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {!CONSIGNMENT_BACKEND_CONFIRMED && (
          <View style={styles.warnBanner}>
            <Text style={styles.warnText}>
              ⚠️ Consignación pendiente de validar con backend. El registro de
              visita/cierre está bloqueado hasta confirmar el contrato.
            </Text>
          </View>
        )}
        {fromCache && (
          <View style={styles.cacheBanner}>
            <Text style={styles.cacheText}>
              📦 Consignación desde caché{!isOnline ? ' · sin conexión' : ''}. Lectura,
              no tiempo real. Registrar visita/cierre requiere conexión.
            </Text>
          </View>
        )}
        <Card>
          <Text style={styles.clientName}>{stop.customer_name}</Text>
          <Text style={styles.dim}>
            Folio {active.name || `#${active.id}`}
            {active.last_visit_date ? ` · última visita ${active.last_visit_date}` : ''}
          </Text>
          <Text style={styles.hint}>
            {canMutate
              ? 'Captura la existencia física actual por producto.'
              : 'Vista de solo lectura. Conéctate para registrar visita o cierre.'}
          </Text>
        </Card>

        {active.lines.map((line) => {
          const c = computeLineCalc(line, parseFloat(physical[line.product_id] ?? '') || 0);
          const hasInput = (physical[line.product_id] ?? '') !== '';
          return (
            <Card key={line.product_id}>
              <Text style={styles.lineName}>{line.product_name}</Text>
              <Text style={styles.lineMeta}>
                Objetivo: {line.target_qty}  ·  Actual: {line.current_qty}  ·  {formatCurrency(line.price_unit)}
                {line.last_count_qty ? `  ·  últ. conteo ${line.last_count_qty}` : ''}
              </Text>
              <View style={styles.countRow}>
                <Text style={styles.countLabel}>Existencia física</Text>
                <TextInput
                  style={styles.countInput}
                  value={physical[line.product_id] ?? ''}
                  onChangeText={(t) => setPhysical((p) => ({ ...p, [line.product_id]: t }))}
                  placeholder="0"
                  placeholderTextColor={colors.textDim}
                  keyboardType="numeric"
                />
              </View>
              {hasInput && (
                <Text style={styles.calcLine}>
                  Vendido: <Text style={styles.calcStrong}>{c.sold_qty}</Text> · Cobro: <Text style={styles.calcStrong}>{formatCurrency(c.charge_amount)}</Text>
                  {!closing ? <> · Resurtir: <Text style={styles.calcStrong}>{c.restock_qty}</Text></> : null}
                </Text>
              )}
            </Card>
          );
        })}

        {/* MVP piloto: método de pago fijo hasta que corte soporte más buckets. */}
        <Card>
          <Text style={styles.stepTitle}>Método de pago</Text>
          <Text style={styles.fixedPaymentText}>{consignmentPaymentLabel(paymentMethod)}</Text>
        </Card>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Preliminar (el servidor confirma)</Text>
          <View style={styles.rowBetween}><Text style={styles.dim}>Vendido / faltante total</Text><Text style={styles.summaryVal}>{totals.soldTotal}</Text></View>
          {!closing && <View style={styles.rowBetween}><Text style={styles.dim}>A resurtir</Text><Text style={styles.summaryVal}>{totals.restockTotal}</Text></View>}
          {closing && <View style={styles.rowBetween}><Text style={styles.dim}>A recuperar / devolver</Text><Text style={styles.summaryVal}>{returnTotal}</Text></View>}
          <View style={styles.rowBetween}><Text style={styles.dim}>Importe estimado a cobrar</Text><Text style={styles.summaryVal}>{formatCurrency(totals.chargeTotal)}</Text></View>
          <View style={styles.rowBetween}><Text style={styles.dim}>Método de pago</Text><Text style={styles.summaryVal}>{consignmentPaymentLabel(paymentMethod)}</Text></View>
          {closing && <Text style={styles.hint}>Al cerrar: se cobra el faltante y se devuelve el producto restante.</Text>}
        </View>

        <Button
          label={submitting ? 'Procesando…' : (closing ? 'Confirmar cierre' : 'Registrar visita')}
          variant="success" onPress={handleVisitOrClose} fullWidth
          disabled={submitting || !canMutate} loading={submitting} style={{ marginTop: 4 }}
        />
        <Button
          label={closing ? '← Volver a visita' : 'Cerrar consignación'}
          variant="secondary"
          onPress={() => setClosing((v) => !v)}
          fullWidth
          disabled={submitting || !canMutate}
          style={{ marginTop: 8 }}
        />
        {!canMutate && (
          <Text style={styles.footNote}>
            Sin conexión: registrar visita y cerrar están deshabilitados. El
            backend es la fuente de verdad de cobro e inventario.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// P0-4 (hardening): gate de readiness antes de consignación.
export default function ConsignmentScreen() {
  return (
    <OperationGate title="Consignación">
      <ConsignmentScreenInner />
    </OperationGate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  dim: { fontSize: 13, color: colors.textDim, lineHeight: 18 },
  errorText: { fontSize: 13, color: '#EF4444', textAlign: 'center' },
  clientName: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 },
  stepTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  hint: { fontSize: 12, color: colors.textDim, marginTop: 6, lineHeight: 16 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addLink: { fontSize: 14, color: colors.primary, fontWeight: '700' },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  lineName: { fontSize: 14, fontWeight: '700', color: colors.text },
  lineMeta: { fontSize: 12, color: colors.textDim, marginTop: 2 },
  lineVal: { fontFamily: fonts.monoBold, fontSize: 13, fontWeight: '700', color: colors.text },
  removeX: { fontSize: 16, color: colors.error, paddingHorizontal: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  totalLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  totalValue: { fontFamily: fonts.monoBold, fontSize: 16, fontWeight: '800', color: colors.success },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 10 },
  countLabel: { fontSize: 13, color: colors.text },
  countInput: {
    width: 110, height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radii.button,
    paddingHorizontal: 12, color: colors.text, fontFamily: fonts.monoBold, fontSize: 16, textAlign: 'right', backgroundColor: colors.card,
  },
  calcLine: { fontSize: 12, color: colors.textDim, marginTop: 8 },
  calcStrong: { fontFamily: fonts.monoBold, color: colors.text, fontWeight: '700' },
  summaryCard: {
    padding: 14, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 6,
  },
  summaryTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, color: colors.textDim, marginBottom: 2 },
  summaryVal: { fontFamily: fonts.monoBold, fontSize: 14, fontWeight: '700', color: colors.text },
  footNote: { fontSize: 11, color: colors.textDim, textAlign: 'center', marginTop: 8, lineHeight: 15 },
  warnBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: 'rgba(234,179,8,0.08)', borderWidth: 1, borderColor: 'rgba(234,179,8,0.45)',
  },
  warnText: { fontSize: 12, lineHeight: 17, color: colors.text },
  cacheBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: 'rgba(37,99,235,0.08)', borderWidth: 1, borderColor: 'rgba(37,99,235,0.35)',
  },
  cacheText: { fontSize: 12, lineHeight: 17, color: colors.text },
  fixedPaymentText: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 8 },
});
