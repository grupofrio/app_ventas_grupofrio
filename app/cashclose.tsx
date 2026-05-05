/**
 * Cash Close screen — End-of-day cash settlement (Corte de Caja).
 *
 * BLD-20260427-P1-CASHCLOSE-LIQUIDATION (sucesor de BLD-20260427-P1-CASHCLOSE-REAL-TOTALS):
 *
 *   Doble fuente intencional:
 *
 *   1. /sales/summary (vía useSalesStore) → "Resumen de venta del día"
 *      - Total Vendido, Pedidos, Kg
 *      - Por qué se mantiene: viene del propio vendedor (sale.order)
 *
 *   2. /pwa-ruta/liquidation (vía fetchLiquidationSummary) → "Cobranza / Liquidación"
 *      - Efectivo, Crédito, Transferencia, Total Cobrado, Total Esperado, Diferencia
 *      - FUENTE DE VERDAD para cash/credit. Suma desde account.payment con
 *        buckets cash/credit/transfer (gf.route.plan.build_liquidation_summary)
 *
 *   Por qué NO usamos summary.cash_amount_total / summary.credit_amount_total:
 *   /sales/summary devuelve esos campos HARDCODED a 0.0 en el backend
 *   (gf_logistics_ops/models/sale_order.py L256-257). Nunca son reales.
 *
 *   3. Diferencia de efectivo físico = efectivoCapturado − payments.cash.total
 *      (sólo si liquidation está disponible)
 *
 *   4. Devoluciones: NO existe endpoint backend (returns_summary). Se muestra
 *      "Pendiente backend".
 *
 *   5. Confirmación de liquidación: NO se agrega botón. Endpoint
 *      /pwa-ruta/liquidacion-confirm existe pero requiere validar deploy en
 *      producción antes de exponer en UI.
 *
 *   Fallback si /pwa-ruta/liquidation falla (404, network, sin plan):
 *   - Mostrar "No disponible" en Efectivo / Crédito / Transferencia / Total a
 *     liquidar / Diferencia de cobranza.
 *   - NO usar campos hardcoded de /sales/summary como fallback (sería falso).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { colors, spacing, radii } from '../src/theme/tokens';
import { useSyncStore } from '../src/stores/useSyncStore';
import { useSalesStore } from '../src/stores/useSalesStore';
import { useRouteStore } from '../src/stores/useRouteStore';
import {
  fetchLiquidationSummary,
  GFLiquidationSummary,
} from '../src/services/gfLogistics';
import { formatCurrency } from '../src/utils/time';
import {
  canConfirmLiquidation,
  describeBlockingReason,
} from '../src/services/cashcloseGuard';

interface SummaryLine {
  label: string;
  value: string;
  highlight?: boolean;
  pending?: boolean;     // estilo "Pendiente backend"
  unavailable?: boolean; // estilo "No disponible"
}

/**
 * Parsea el input de efectivo. Acepta "1234.56", "1,234.56", vacío → 0.
 * NaN-safe.
 */
function parseCashInput(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(',', '.');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Formatea diferencia con signo legible para UI.
 *   > 0 → "+$X.XX" (sobrante)
 *   < 0 → "-$X.XX" (faltante)
 *   = 0 → "$0.00"
 */
function formatSignedDiff(diff: number): string {
  if (diff > 0) return `+${formatCurrency(Math.abs(diff))}`;
  if (diff < 0) return `-${formatCurrency(Math.abs(diff))}`;
  return formatCurrency(0);
}

function colorForDiff(diff: number): string {
  if (diff > 0) return colors.success;
  if (diff < 0) return '#EF4444';
  return colors.text;
}

export default function CashCloseScreen() {
  const [cashInHand, setCashInHand] = useState('');

  // Sync queue
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const totalItems = useSyncStore((s) => s.queue.length);
  const isOnline = useSyncStore((s) => s.isOnline);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const processQueue = useSyncStore((s) => s.processQueue);
  const errorCount = useSyncStore((s) => s.errorCount);

  // BLD-20260505-CLOSESYNC: Sincronización local de UI. NO emite alerts
  // automáticas; sólo se levanta una alerta si el usuario presionó
  // "Sincronizar" y el resultado quedó con pendientes.
  const [syncBusy, setSyncBusy] = useState(false);
  const [postSyncMessage, setPostSyncMessage] = useState<string | null>(null);

  // Resumen de venta del día (sale.order vía /sales/summary)
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);
  const summary = useSalesStore((s) => s.summary);
  const isSalesLoading = useSalesStore((s) => s.isLoading);
  const salesError = useSalesStore((s) => s.error);

  // Plan del día (para resolver plan_id en liquidation)
  const plan = useRouteStore((s) => s.plan);
  const planId = plan?.plan_id ?? null;

  // Liquidation summary (account.payment vía /pwa-ruta/liquidation)
  const [liquidation, setLiquidation] = useState<GFLiquidationSummary | null>(null);
  const [liquidationLoading, setLiquidationLoading] = useState(false);
  const [liquidationError, setLiquidationError] = useState<string | null>(null);

  const loadLiquidation = useCallback(async () => {
    setLiquidationLoading(true);
    setLiquidationError(null);
    try {
      // Si no hay plan_id, intentamos sin él — el backend resuelve por sesión
      // del empleado vía _run_with_session_employee + _get_plan_for_employee.
      const data = await fetchLiquidationSummary(
        planId ? { plan_id: planId } : {},
      );
      setLiquidation(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      setLiquidationError(message);
      setLiquidation(null);
    } finally {
      setLiquidationLoading(false);
    }
  }, [planId]);

  // Refrescar ambas fuentes al enfocar la pantalla
  useFocusEffect(
    useCallback(() => {
      void loadTodaySales();
      void loadLiquidation();
    }, [loadTodaySales, loadLiquidation]),
  );

  // BLD-20260505-CLOSESYNC: forzar sincronización de pendientes desde el
  // corte. La app SIEMPRE intenta auto-procesar la cola al reconectar
  // (useSyncStore.setOnline), pero el vendedor que regresa al CEDIS
  // necesita un punto explícito antes de "cerrar caja" donde:
  //  1. ve cuántas operaciones quedan,
  //  2. dispara el ciclo de sync,
  //  3. confirma que efectivamente bajó a 0 antes de revisar liquidación.
  // No agrega ningún botón mutante nuevo (Confirmar Liquidación queda
  // pendiente). Sólo encadena processQueue() + recarga de liquidación.
  const handleSyncPending = useCallback(async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    setPostSyncMessage(null);
    try {
      await processQueue();
      // Releer estado fresh del store post-sync.
      const after = useSyncStore.getState().pendingCount;
      // Refrescar liquidación porque pudo cambiar tras drenar pagos.
      await loadLiquidation();
      if (after === 0) {
        setPostSyncMessage('Todo sincronizado.');
      } else {
        Alert.alert(
          'Quedan pendientes',
          'No se pudo sincronizar todo. Revisa tu conexión e intenta de nuevo.',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      Alert.alert('Error al sincronizar', message);
    } finally {
      setSyncBusy(false);
    }
  }, [syncBusy, processQueue, loadLiquidation]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const liquidationAvailable = liquidation !== null && !liquidationError;
  const hasLiquidationData = liquidationAvailable && liquidation;

  // BLD-20260505-CLOSESYNC: helper exportado/puro (cashcloseGuard.ts).
  // Cuando se agregue el botón "Confirmar Liquidación", debe permanecer
  // DESHABILITADO si pendingCount > 0 — vendedor no puede cerrar mientras
  // queden ventas/pagos sin emitir al backend, eso falsea el corte.
  const guardInput = {
    pendingCount,
    isSyncing: isSyncing || syncBusy,
    liquidationAvailable: !!hasLiquidationData,
  };
  const _canConfirm = canConfirmLiquidation(guardInput); // eslint-disable-line @typescript-eslint/no-unused-vars
  const blockingReason = describeBlockingReason(guardInput);

  const cashCaptured = useMemo(() => parseCashInput(cashInHand), [cashInHand]);
  const cashExpected = hasLiquidationData ? liquidation.payments.cash.total : 0;
  const physicalDiff = cashCaptured - cashExpected;
  const hasInput = cashInHand.trim().length > 0;
  const collectionDiff = hasLiquidationData
    ? liquidation.total_collected - liquidation.total_expected
    : 0;

  const noOrdersToday =
    !isSalesLoading && !salesError && summary.orders_count === 0;

  // ── UI line builders ───────────────────────────────────────────────────────
  // Sección 1: Resumen de venta (sale.order)
  const saleSummaryLines: SummaryLine[] = [
    { label: 'Total Vendido', value: formatCurrency(summary.sales_amount_total) },
    { label: 'Pedidos', value: String(summary.orders_count || 0) },
    { label: 'Kg vendidos', value: `${(summary.kg_total || 0).toFixed(1)} kg` },
  ];

  // Sección 2: Cobranza / Liquidación (account.payment)
  const cobranzaLines: SummaryLine[] = hasLiquidationData
    ? [
        { label: 'Efectivo esperado', value: formatCurrency(liquidation.payments.cash.total) },
        { label: 'Crédito', value: formatCurrency(liquidation.payments.credit.total) },
        { label: 'Transferencia', value: formatCurrency(liquidation.payments.transfer.total) },
        { label: 'Total cobrado', value: formatCurrency(liquidation.total_collected) },
        { label: 'Total esperado', value: formatCurrency(liquidation.total_expected) },
        {
          label: 'Diferencia cobranza',
          value: formatSignedDiff(collectionDiff),
        },
        {
          label: 'Total a Liquidar',
          value: formatCurrency(liquidation.payments.cash.total),
          highlight: true,
        },
      ]
    : [
        { label: 'Efectivo esperado', value: 'No disponible', unavailable: true },
        { label: 'Crédito', value: 'No disponible', unavailable: true },
        { label: 'Transferencia', value: 'No disponible', unavailable: true },
        { label: 'Total cobrado', value: 'No disponible', unavailable: true },
        { label: 'Total esperado', value: 'No disponible', unavailable: true },
        { label: 'Diferencia cobranza', value: 'No disponible', unavailable: true },
        {
          label: 'Total a Liquidar',
          value: 'No disponible',
          highlight: true,
          unavailable: true,
        },
      ];

  // Sección 3: Operativo (sync queue + devoluciones pendientes backend)
  const opsLines: SummaryLine[] = [
    { label: 'Devoluciones', value: 'Pendiente backend', pending: true },
    { label: 'Ops. sincronizadas', value: `${totalItems - pendingCount}/${totalItems}` },
  ];

  // Color del valor de Diferencia cobranza (sólo si liquidation está)
  const collectionDiffColor = hasLiquidationData
    ? colorForDiff(collectionDiff)
    : colors.textDim;

  // Diferencia física (input vs efectivo esperado)
  const physicalDiffLabel = !hasLiquidationData
    ? 'No disponible'
    : !hasInput
      ? 'Captura efectivo'
      : formatSignedDiff(physicalDiff);

  const physicalDiffColor = !hasLiquidationData
    ? colors.textDim
    : !hasInput
      ? colors.textDim
      : colorForDiff(physicalDiff);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TopBar title="Corte de Caja" showBack />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* Banner honesto */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoIcon}>ℹ️</Text>
          <Text style={styles.infoText}>
            Resumen informativo. Confirmacion de liquidacion pendiente de validar deploy backend.
          </Text>
        </View>

        {/* BLD-20260505-CLOSESYNC: card de sincronización antes de cerrar.
            Visible siempre — refleja el estado real de la cola y guía al
            vendedor a sincronizar con WiFi del CEDIS antes de revisar
            cobranza. NO añade botón "Confirmar Liquidación" todavía. */}
        {pendingCount > 0 ? (
          <View style={[styles.syncCard, styles.syncCardPending]}>
            <View style={styles.syncHeader}>
              <Text style={styles.syncIcon}>📡</Text>
              <Text style={styles.syncTitle}>Operaciones pendientes por sincronizar</Text>
            </View>
            <Text style={styles.syncBody}>
              Antes de cerrar o liquidar, conéctate al WiFi de la sucursal y sincroniza todo lo pendiente.
            </Text>
            <Text style={styles.syncMetric}>
              Pendientes: {pendingCount}
              {errorCount > 0 ? `  ·  Con error: ${errorCount}` : ''}
            </Text>
            <TouchableOpacity
              style={[
                styles.syncBtn,
                (syncBusy || isSyncing || !isOnline) && styles.syncBtnDisabled,
              ]}
              onPress={handleSyncPending}
              disabled={syncBusy || isSyncing || !isOnline}
              accessibilityRole="button"
              accessibilityLabel="Sincronizar operaciones pendientes"
            >
              {syncBusy || isSyncing ? (
                <View style={styles.syncBtnInner}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.syncBtnText}>Sincronizando…</Text>
                </View>
              ) : (
                <Text style={styles.syncBtnText}>Sincronizar pendientes</Text>
              )}
            </TouchableOpacity>
            {!isOnline && (
              <Text style={styles.syncHint}>
                Sin conexión: conéctate al WiFi del CEDIS para sincronizar.
              </Text>
            )}
            {blockingReason && (
              <Text style={styles.syncHint}>{blockingReason}</Text>
            )}
          </View>
        ) : (
          <View style={[styles.syncCard, styles.syncCardOk]}>
            <View style={styles.syncHeader}>
              <Text style={styles.syncIcon}>✅</Text>
              <Text style={styles.syncTitle}>Todo sincronizado</Text>
            </View>
            <Text style={styles.syncBody}>
              {postSyncMessage || 'Puedes revisar tu liquidación.'}
            </Text>
          </View>
        )}

        {/* Estados de carga / error de Sales */}
        {isSalesLoading && (
          <View style={styles.statusCard}>
            <Text style={styles.statusText}>Cargando ventas del dia...</Text>
          </View>
        )}

        {!isSalesLoading && salesError && (
          <View style={[styles.statusCard, styles.statusError]}>
            <Text style={styles.statusErrorText}>{salesError}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => { void loadTodaySales(); }}
              accessibilityRole="button"
              accessibilityLabel="Reintentar carga de ventas del dia"
            >
              <Text style={styles.retryButtonText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        )}

        {noOrdersToday && (
          <View style={styles.statusCard}>
            <Text style={styles.statusText}>Sin ventas registradas hoy</Text>
          </View>
        )}

        {/* Sección 1: Resumen de venta */}
        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Resumen de venta</Text>
          {saleSummaryLines.map((line) => (
            <View key={line.label} style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{line.label}</Text>
              <Text style={styles.summaryValue}>{line.value}</Text>
            </View>
          ))}
        </View>

        {/* Sección 2: Cobranza / Liquidación */}
        <View style={styles.summaryCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Cobranza / Liquidacion</Text>
            {liquidationLoading && (
              <Text style={styles.sectionSubText}>Cargando...</Text>
            )}
          </View>

          {/* Mensaje de error de liquidation con retry */}
          {!liquidationLoading && liquidationError && (
            <View style={[styles.statusCard, styles.statusErrorInline]}>
              <Text style={styles.statusErrorText}>
                Liquidación no disponible en backend
              </Text>
              <Text style={styles.statusSubText}>{liquidationError}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => { void loadLiquidation(); }}
                accessibilityRole="button"
                accessibilityLabel="Reintentar carga de liquidación"
              >
                <Text style={styles.retryButtonText}>Reintentar</Text>
              </TouchableOpacity>
            </View>
          )}

          {cobranzaLines.map((line) => {
            // Color especial para "Diferencia cobranza" cuando está disponible
            const isCollectionDiff = line.label === 'Diferencia cobranza';
            const valueStyle = [
              styles.summaryValue,
              line.highlight && styles.highlightValue,
              line.pending && styles.pendingValue,
              line.unavailable && styles.unavailableValue,
              isCollectionDiff && hasLiquidationData && { color: collectionDiffColor, fontWeight: '700' as const },
            ];
            return (
              <View key={line.label} style={styles.summaryRow}>
                <Text
                  style={[
                    styles.summaryLabel,
                    line.highlight && styles.highlightLabel,
                  ]}
                >
                  {line.label}
                </Text>
                <Text style={valueStyle}>{line.value}</Text>
              </View>
            );
          })}
        </View>

        {/* Sección 3: Operativo */}
        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Operativo</Text>
          {opsLines.map((line) => (
            <View key={line.label} style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{line.label}</Text>
              <Text
                style={[
                  styles.summaryValue,
                  line.pending && styles.pendingValue,
                ]}
              >
                {line.value}
              </Text>
            </View>
          ))}
        </View>

        {/* Sección 4: Efectivo físico */}
        <View style={styles.inputCard}>
          <Text style={styles.sectionTitle}>Efectivo en Mano</Text>
          <Text style={styles.inputHint}>
            Cuenta el efectivo fisico y captura el total
          </Text>
          <TextInput
            style={styles.cashInput}
            placeholder="$0.00"
            placeholderTextColor={colors.textDim}
            keyboardType="decimal-pad"
            value={cashInHand}
            onChangeText={setCashInHand}
            accessibilityLabel="Efectivo en mano"
          />
        </View>

        <View style={styles.differenceCard}>
          <Text style={styles.differenceLabel}>Diferencia física vs Efectivo esperado</Text>
          <Text style={[styles.differenceValue, { color: physicalDiffColor }]}>
            {physicalDiffLabel}
          </Text>
          <Text style={styles.differenceHint}>
            Positivo = sobrante, Negativo = faltante
          </Text>
        </View>

        <Text style={styles.footerNote}>
          Fuente de cobranza: /pwa-ruta/liquidation (account.payment por bucket).
          La confirmacion final se habilitara cuando se valide el deploy backend.
          El supervisor revisara las diferencias mayores a $50.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radii.button,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  // BLD-20260505-CLOSESYNC: sync-pending card styles.
  syncCard: {
    borderRadius: radii.button,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
  },
  syncCardPending: {
    backgroundColor: 'rgba(234,179,8,0.07)',
    borderColor: 'rgba(234,179,8,0.4)',
  },
  syncCardOk: {
    backgroundColor: 'rgba(34,197,94,0.06)',
    borderColor: 'rgba(34,197,94,0.3)',
  },
  syncHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  syncIcon: { fontSize: 18 },
  syncTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  syncBody: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textDim,
    marginBottom: 8,
  },
  syncMetric: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  syncBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  syncBtnDisabled: { opacity: 0.5 },
  syncBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  syncBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  syncHint: {
    fontSize: 11,
    color: colors.textDim,
    marginTop: 8,
    textAlign: 'center',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionSubText: {
    fontSize: 12,
    color: colors.textDim,
    marginBottom: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  summaryLabel: {
    fontSize: 15,
    color: colors.textDim,
  },
  summaryValue: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  highlightLabel: {
    color: colors.text,
    fontWeight: '700',
  },
  highlightValue: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 17,
  },
  pendingValue: {
    color: colors.textDim,
    fontStyle: 'italic',
    fontWeight: '500',
  },
  unavailableValue: {
    color: colors.textDim,
    fontStyle: 'italic',
    fontWeight: '500',
  },
  inputCard: {
    backgroundColor: colors.card,
    borderRadius: radii.button,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  inputHint: {
    fontSize: 13,
    color: colors.textDim,
    marginBottom: spacing.md,
  },
  cashInput: {
    backgroundColor: colors.bg,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  differenceCard: {
    backgroundColor: colors.card,
    borderRadius: radii.button,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  differenceLabel: {
    fontSize: 13,
    color: colors.textDim,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  differenceValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  differenceHint: {
    fontSize: 11,
    color: colors.textDim,
  },
  footerNote: {
    fontSize: 12,
    color: colors.textDim,
    lineHeight: 18,
    textAlign: 'center',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(37,99,235,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.2)',
    borderRadius: radii.button,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: 8,
  },
  infoIcon: { fontSize: 18 },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: colors.text,
    fontWeight: '500',
    lineHeight: 16,
  },
  statusCard: {
    backgroundColor: colors.card,
    borderRadius: radii.button,
    padding: spacing.md,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 13,
    color: colors.textDim,
  },
  statusSubText: {
    fontSize: 11,
    color: colors.textDim,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  statusError: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  statusErrorInline: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
    marginBottom: spacing.md,
  },
  statusErrorText: {
    fontSize: 13,
    color: '#EF4444',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  retryButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
  },
  retryButtonText: {
    fontSize: 13,
    color: '#EF4444',
    fontWeight: '700',
  },
});
