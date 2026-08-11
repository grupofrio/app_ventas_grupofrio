/**
 * Sales tab — s-sales in mockup (lines 469-491).
 * Daily sales summary, KPIs, order list.
 *
 * La lista combina pedidos remotos de Odoo con ventas locales encoladas
 * (proyección de pendientes, diseño 2026-07-23). Los KPI oficiales leen SOLO
 * el summary remoto: una venta pendiente nunca infla Vendido/Pedidos/Kg.
 */

import React, { useCallback } from 'react';
import { Alert, View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { KPICard } from '../../src/components/ui/KPICard';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useSalesStore } from '../../src/stores/useSalesStore';
import { formatCurrency } from '../../src/utils/time';
import { useSalesListProjection } from '../../src/hooks/useSalesListProjection';
import type { SalesListEntry } from '../../src/services/salesListProjection';
import {
  describeLocalSaleStatus,
  LOCAL_AMOUNT_UNAVAILABLE_LABEL,
  type LocalSaleTone,
} from '../../src/services/localSaleStatusCopy';
import { openSaleTicketForOrder } from '../../src/services/saleTicketOpen';
import {
  loadSaleTicketSnapshotStrict,
  saveSaleTicketSnapshot,
} from '../../src/services/saleTicketStorage';

function showTicketOpenError() {
  console.error('[sales] No se pudo abrir el ticket');
  Alert.alert(
    'No se pudo abrir el ticket',
    'Intenta nuevamente. Permanecerás en la pantalla de Ventas.',
  );
}

const TONE_COLORS: Record<LocalSaleTone, { bg: string; text: string }> = {
  pending: { bg: 'rgba(255,255,255,0.08)', text: colors.textDim },
  active: { bg: colors.successAlpha12, text: colors.success },
  warning: { bg: colors.warningAlpha12, text: colors.warning },
  danger: { bg: colors.errorAlpha12, text: colors.error },
};

export default function SalesScreen() {
  const router = useRouter();
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);
  const summary = useSalesStore((s) => s.summary);
  const { entries, localSummary, ticketsLoading } = useSalesListProjection();

  useFocusEffect(
    useCallback(() => {
      void loadTodaySales();
    }, [loadTodaySales]),
  );

  // KPI oficiales: SOLO summary remoto (nunca pendientes locales).
  const todaySales = summary.sales_amount_total;
  const todayKg = summary.kg_total;
  const todayOrders = summary.orders_count;
  const monthlyTarget = summary.monthly_target;
  const monthlyAchieved = summary.monthly_achieved;
  const progressPct = monthlyTarget > 0
    ? Math.round((monthlyAchieved / monthlyTarget) * 100) : 0;

  function openTicketForEntry(entry: SalesListEntry) {
    if (entry.origin === 'odoo' && entry.remoteOrder) {
      return openSaleTicketForOrder(entry.remoteOrder, {
        load: loadSaleTicketSnapshotStrict,
        save: saveSaleTicketSnapshot,
        navigate: (ticketId) => router.push(`/print/${ticketId}` as never),
        onError: showTicketOpenError,
      });
    }
    // Tarjeta local: el ticket vive bajo sale-ticket:<operationId>.
    router.push(`/print/${entry.operationId}` as never);
    return Promise.resolve();
  }

  const hasEntries = entries.length > 0;
  const showPendingCard = localSummary.count > 0 || localSummary.needsAttentionCount > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title="📊 Ventas del dia"
        rightAction={{
          label: '💰 Corte',
          onPress: () => router.push('/cashclose' as never),
        }}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* Action buttons */}
        <View style={styles.actionRow}>
          <Button label="💰 Corte y Liquidacion" variant="primary" small
            onPress={() => router.push('/cashclose' as never)} style={{ flex: 1.4 }} />
          <Button label="📈 Analiticas" variant="secondary" small
            onPress={() => router.push('/analytics' as never)} style={{ flex: 1 }} />
        </View>

        {/* KPIs — solo datos oficiales de Odoo */}
        <View style={styles.kpiGrid}>
          <KPICard style={styles.kpiCard} label="VENDIDO" value={formatCurrency(todaySales)}
                   valueColor={colors.success} />
          <KPICard style={styles.kpiCard} label="META" value={monthlyTarget > 0 ? `$${(monthlyTarget/1000).toFixed(1)}k` : 'Sin dato'}
                   subtitle={`${progressPct}%`} />
          <KPICard style={styles.kpiCard} label="PEDIDOS" value={`${todayOrders}`} />
          <KPICard style={styles.kpiCard} label="KG" value={`${todayKg}`} />
        </View>

        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
        <Text style={styles.progressText}>{progressPct}% de meta diaria</Text>

        {/* Resumen independiente de pendientes (no toca KPI oficiales) */}
        {showPendingCard && (
          <View style={styles.pendingCard}>
            <Text style={styles.pendingTitle}>Pendiente de sincronizar</Text>
            {localSummary.count > 0 && (
              <Text style={styles.pendingAmount}>
                {formatCurrency(localSummary.knownAmountTotal)}
                {' · '}
                {localSummary.count} {localSummary.count === 1 ? 'venta' : 'ventas'}
              </Text>
            )}
            {localSummary.unknownAmountCount > 0 && (
              <Text style={styles.pendingDetail}>
                {localSummary.unknownAmountCount}{' '}
                {localSummary.unknownAmountCount === 1 ? 'venta' : 'ventas'} sin monto
              </Text>
            )}
            {localSummary.needsAttentionCount > 0 && (
              <Text style={styles.pendingAttention}>
                {localSummary.needsAttentionCount}{' '}
                {localSummary.needsAttentionCount === 1 ? 'operación requiere' : 'operaciones requieren'} atención
              </Text>
            )}
          </View>
        )}

        {/* Orders list — proyección unificada local + Odoo */}
        <Text style={styles.sectionTitle}>PEDIDOS</Text>
        {!hasEntries ? (
          <View style={styles.emptyCard}>
            <Text style={typography.dim}>Sin pedidos registrados hoy</Text>
            <Text style={[typography.dimSmall, { marginTop: 4 }]}>
              Las ventas aparecen aqui al confirmar pedidos
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {entries.map((entry) => {
              const statusCopy = entry.localStatus
                ? describeLocalSaleStatus(entry.localStatus)
                : null;
              const toneColors = statusCopy ? TONE_COLORS[statusCopy.tone] : null;
              const localTicketPending = entry.origin === 'local' && ticketsLoading;
              return (
                <TouchableOpacity
                  key={entry.key}
                  style={styles.orderCard}
                  onPress={() => {
                    if (localTicketPending) {
                      Alert.alert(
                        'Ticket cargando',
                        'El comprobante local se está cargando; intenta de nuevo en un momento.',
                      );
                      return;
                    }
                    void openTicketForEntry(entry);
                  }}
                  activeOpacity={0.82}
                >
                  <View style={styles.orderRow}>
                    <Text style={styles.orderName}>
                      {entry.origin === 'odoo' && entry.remoteOrder
                        ? entry.remoteOrder.name
                        : entry.customerName}
                    </Text>
                    <Text style={styles.orderAmount}>
                      {entry.amountTotal !== null
                        ? formatCurrency(entry.amountTotal)
                        : LOCAL_AMOUNT_UNAVAILABLE_LABEL}
                    </Text>
                  </View>
                  <Text style={styles.orderMeta}>
                    {entry.origin === 'odoo' && entry.remoteOrder
                      ? `${entry.remoteOrder.partner_name} · ${entry.remoteOrder.kg_total.toFixed(0)} kg`
                      : entry.kgTotal !== null
                        ? `${entry.kgTotal.toFixed(0)} kg`
                        : 'Venta local'}
                  </Text>
                  {statusCopy && toneColors && (
                    <View style={[styles.statusBadge, { backgroundColor: toneColors.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: toneColors.text }]}>
                        {statusCopy.label}
                      </Text>
                    </View>
                  )}
                  {entry.errorMessage ? (
                    <Text style={styles.orderError}>{entry.errorMessage}</Text>
                  ) : null}
                  <Text style={styles.orderHint}>
                    {localTicketPending ? 'Cargando ticket…' : 'Toca para abrir PDF'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  actionRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: { flexBasis: '48%' },
  progressBar: {
    height: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', borderRadius: 4,
    backgroundColor: colors.primary,
  },
  progressText: { fontSize: 10, color: colors.textDim, textAlign: 'center', marginBottom: 14 },
  pendingCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 4,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  pendingTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: colors.textDim,
  },
  pendingAmount: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    fontFamily: fonts.monoBold,
  },
  pendingDetail: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textDim,
  },
  pendingAttention: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700',
    color: colors.error,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  emptyCard: {
    backgroundColor: colors.card, borderRadius: radii.card, padding: 20, alignItems: 'center',
  },
  list: { gap: 8 },
  orderCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 14,
  },
  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
  },
  orderName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    fontFamily: fonts.bodyBold,
  },
  orderAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.success,
    fontFamily: fonts.monoBold,
  },
  orderMeta: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textDim,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  orderError: {
    marginTop: 6,
    fontSize: 11,
    color: colors.error,
  },
  orderHint: {
    marginTop: 8,
    fontSize: 11,
    color: colors.primary,
    fontWeight: '700',
  },
});
