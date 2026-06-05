/**
 * Sales tab — s-sales in mockup (lines 469-491).
 * Daily sales summary, KPIs, order list.
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { KPICard } from '../../src/components/ui/KPICard';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useSalesStore } from '../../src/stores/useSalesStore';
import { formatCurrency } from '../../src/utils/time';
import { GFSalesOrder } from '../../src/services/gfLogistics';
import { buildSaleTicketSnapshotFromOrder } from '../../src/services/saleTicket';
import { loadSaleTicketSnapshot, saveSaleTicketSnapshot } from '../../src/services/saleTicketStorage';

export default function SalesScreen() {
  const router = useRouter();
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);
  const summary = useSalesStore((s) => s.summary);
  const orders = useSalesStore((s) => s.orders);

  useFocusEffect(
    useCallback(() => {
      void loadTodaySales();
    }, [loadTodaySales]),
  );

  const todaySales = summary.sales_amount_total;
  const todayKg = summary.kg_total;
  const todayOrders = summary.orders_count;
  const monthlyTarget = summary.monthly_target;
  const monthlyAchieved = summary.monthly_achieved;
  const progressPct = monthlyTarget > 0
    ? Math.round((monthlyAchieved / monthlyTarget) * 100) : 0;

  async function openTicketForOrder(order: GFSalesOrder) {
    const ticket = buildSaleTicketSnapshotFromOrder(order);
    const ticketId = ticket.saleId;
    const existingTicket = await loadSaleTicketSnapshot(ticketId);
    if (!existingTicket) {
      await saveSaleTicketSnapshot(ticket);
    }
    router.push(`/print/${ticketId}` as never);
  }

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

        {/* KPIs */}
        <View style={styles.kpiGrid}>
          <KPICard label="VENDIDO" value={formatCurrency(todaySales)}
                   valueColor={colors.success} />
          <KPICard label="META" value={monthlyTarget > 0 ? `$${(monthlyTarget/1000).toFixed(1)}k` : '--'}
                   subtitle={`${progressPct}%`} />
          <KPICard label="PEDIDOS" value={`${todayOrders}`} />
          <KPICard label="KG" value={`${todayKg}`} />
        </View>

        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
        <Text style={styles.progressText}>{progressPct}% de meta diaria</Text>

        {/* Orders list */}
        <Text style={styles.sectionTitle}>PEDIDOS</Text>
        {todayOrders === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={typography.dim}>Sin pedidos registrados hoy</Text>
            <Text style={[typography.dimSmall, { marginTop: 4 }]}>
              Las ventas aparecen aqui al confirmar pedidos
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {orders.map((order) => (
              <TouchableOpacity
                key={order.id}
                style={styles.orderCard}
                onPress={() => void openTicketForOrder(order)}
                activeOpacity={0.82}
              >
                <View style={styles.orderRow}>
                  <Text style={styles.orderName}>{order.name}</Text>
                  <Text style={styles.orderAmount}>{formatCurrency(order.amount_total)}</Text>
                </View>
                <Text style={styles.orderMeta}>
                  {order.partner_name} · {order.kg_total.toFixed(0)} kg
                </Text>
                <Text style={styles.orderHint}>Toca para abrir PDF</Text>
              </TouchableOpacity>
            ))}
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
  progressBar: {
    height: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', borderRadius: 4,
    backgroundColor: colors.primary,
  },
  progressText: { fontSize: 10, color: colors.textDim, textAlign: 'center', marginBottom: 14 },
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
  orderHint: {
    marginTop: 8,
    fontSize: 11,
    color: colors.primary,
    fontWeight: '700',
  },
});
