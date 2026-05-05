/**
 * Cash Close screen — End-of-day cash settlement (Corte de Caja).
 *
 * BLD-20260427-P1-CASHCLOSE-REAL-TOTALS:
 *   Convertido de stub "Proximamente" a resumen MVP usando datos reales que
 *   ya expone useSalesStore (vía /sales/summary y /sales/list en gfLogistics).
 *
 *   Lo que muestra ahora:
 *     - Total Vendido, Efectivo, Crédito, Pedidos, Kg → datos reales del día
 *     - Ops. sincronizadas → useSyncStore (igual que antes)
 *     - Devoluciones → "Pendiente backend" (sin endpoint todavía, no inventamos)
 *     - Total a Liquidar = summary.cash_amount_total (efectivo esperado)
 *     - Diferencia = efectivo capturado − efectivo esperado
 *
 *   Lo que NO hace todavía (pendiente backend):
 *     - Confirmar/cerrar el corte (no hay endpoint, no se agrega botón falso)
 *     - Devoluciones del día (no existe endpoint hoy)
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { colors, spacing, radii } from '../src/theme/tokens';
import { useSyncStore } from '../src/stores/useSyncStore';
import { useSalesStore } from '../src/stores/useSalesStore';
import { formatCurrency } from '../src/utils/time';

interface SummaryLine {
  label: string;
  value: string;
  highlight?: boolean;
  pending?: boolean; // Si es true, se renderiza con estilo "pendiente backend"
}

/**
 * Parsea el input de efectivo. Acepta "1234.56", "1,234.56", "1234,56", etc.
 * Devuelve 0 si está vacío o no parseable (NaN-safe).
 */
function parseCashInput(raw: string): number {
  if (!raw) return 0;
  // Normalizar: quitar todo excepto dígitos, punto y coma; coma → punto
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(',', '.');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export default function CashCloseScreen() {
  const [cashInHand, setCashInHand] = useState('');

  // Sync queue (igual que antes)
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const totalItems = useSyncStore((s) => s.queue.length);

  // Datos reales de ventas del día
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);
  const summary = useSalesStore((s) => s.summary);
  const isLoading = useSalesStore((s) => s.isLoading);
  const error = useSalesStore((s) => s.error);

  // Refrescar al enfocar la pantalla (mismo patrón que (tabs)/sales.tsx)
  useFocusEffect(
    useCallback(() => {
      void loadTodaySales();
    }, [loadTodaySales]),
  );

  // Cálculos derivados
  const cashCapturedRaw = useMemo(() => parseCashInput(cashInHand), [cashInHand]);
  const cashExpected = summary.cash_amount_total || 0;
  const difference = cashCapturedRaw - cashExpected;
  const hasInput = cashInHand.trim().length > 0;
  const noOrdersToday = !isLoading && !error && summary.orders_count === 0;

  // Diferencia con signo legible (sobrante/faltante)
  const differenceLabel = !hasInput
    ? 'Captura efectivo'
    : difference > 0
      ? `+${formatCurrency(Math.abs(difference))}`
      : difference < 0
        ? `-${formatCurrency(Math.abs(difference))}`
        : formatCurrency(0);

  const differenceColor = !hasInput
    ? colors.textDim
    : difference > 0
      ? colors.success
      : difference < 0
        ? '#EF4444'
        : colors.text;

  // Líneas del resumen — datos reales
  const summaryLines: SummaryLine[] = [
    { label: 'Total Vendido', value: formatCurrency(summary.sales_amount_total) },
    { label: 'Efectivo', value: formatCurrency(summary.cash_amount_total) },
    { label: 'Credito', value: formatCurrency(summary.credit_amount_total) },
    { label: 'Pedidos', value: String(summary.orders_count || 0) },
    { label: 'Kg vendidos', value: `${(summary.kg_total || 0).toFixed(1)} kg` },
    { label: 'Devoluciones', value: 'Pendiente backend', pending: true },
    { label: 'Ops. sincronizadas', value: `${totalItems - pendingCount}/${totalItems}` },
    { label: 'Total a Liquidar', value: formatCurrency(summary.cash_amount_total), highlight: true },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TopBar title="Corte de Caja" showBack />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* Banner honesto: ya no es stub completo, sólo aclara que falta confirmación final */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoIcon}>ℹ️</Text>
          <Text style={styles.infoText}>
            Resumen informativo con ventas del dia. Confirmacion final de corte pendiente de backend.
          </Text>
        </View>

        {/* Estados de carga / error / sin ventas */}
        {isLoading && (
          <View style={styles.statusCard}>
            <Text style={styles.statusText}>Cargando ventas del dia...</Text>
          </View>
        )}

        {!isLoading && error && (
          <View style={[styles.statusCard, styles.statusError]}>
            <Text style={styles.statusErrorText}>{error}</Text>
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

        {/* Resumen del día */}
        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Resumen del Dia</Text>
          {summaryLines.map((line) => (
            <View key={line.label} style={styles.summaryRow}>
              <Text
                style={[
                  styles.summaryLabel,
                  line.highlight && styles.highlightLabel,
                ]}
              >
                {line.label}
              </Text>
              <Text
                style={[
                  styles.summaryValue,
                  line.highlight && styles.highlightValue,
                  line.pending && styles.pendingValue,
                ]}
              >
                {line.value}
              </Text>
            </View>
          ))}
        </View>

        {/* Input efectivo en mano */}
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

        {/* Diferencia */}
        <View style={styles.differenceCard}>
          <Text style={styles.differenceLabel}>Diferencia</Text>
          <Text style={[styles.differenceValue, { color: differenceColor }]}>
            {differenceLabel}
          </Text>
          <Text style={styles.differenceHint}>
            Positivo = sobrante, Negativo = faltante
          </Text>
        </View>

        <Text style={styles.footerNote}>
          La confirmacion final del corte se habilitara cuando el backend exponga el endpoint correspondiente.
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
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  // Banner informativo (reemplaza el stub banner amarillo)
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
  // Estados (loading / error / sin ventas)
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
  statusError: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
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
