/**
 * Analytics screen — daily/weekly metrics.
 * V1: Structure with derived data from local stores.
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { KPICard } from '../src/components/ui/KPICard';
import { Card } from '../src/components/ui/Card';
import { colors, spacing, radii } from '../src/theme/tokens';
import { typography } from '../src/theme/typography';
import { useRouteStore } from '../src/stores/useRouteStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import { useSalesStore } from '../src/stores/useSalesStore';
import { formatCurrency } from '../src/utils/time';

export default function AnalyticsScreen() {
  const { stopsCompleted, stopsTotal, progressPct } = useRouteStore();
  const pendingOps = useSyncStore((s) => s.pendingCount);
  const summary = useSalesStore((s) => s.summary);
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);

  useFocusEffect(
    useCallback(() => {
      void loadTodaySales();
    }, [loadTodaySales]),
  );

  const visitPct = stopsTotal > 0 ? Math.round((stopsCompleted / stopsTotal) * 100) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="📈 Analiticas" showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>HOY</Text>
        <View style={styles.kpiGrid}>
          <KPICard style={styles.kpiCard} label="VISITAS" value={`${stopsCompleted}/${stopsTotal}`}
                   subtitle={`${visitPct}% completado`} />
          <KPICard style={styles.kpiCard} label="VENTAS" value={formatCurrency(summary.sales_amount_total)} subtitle={`${summary.orders_count} pedidos`}
                   valueColor={colors.success} />
          <KPICard style={styles.kpiCard} label="COBRADO" value={formatCurrency(summary.cash_amount_total + summary.credit_amount_total)} subtitle="corte del dia" />
          <KPICard style={styles.kpiCard} label="SYNC" value={`${pendingOps}`} subtitle="pendientes"
                   valueColor={pendingOps > 0 ? colors.warning : colors.success} />
        </View>

        <Text style={styles.sectionTitle}>EFECTIVIDAD</Text>
        <Card>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Tasa de venta</Text>
            <Text style={styles.metricValue}>Sin dato</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Ticket promedio</Text>
            <Text style={styles.metricValue}>{formatCurrency(summary.avg_ticket)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>kg promedio/visita</Text>
            <Text style={styles.metricValue}>{summary.orders_count > 0 ? `${(summary.kg_total / summary.orders_count).toFixed(1)} kg` : 'Sin dato'}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Tiempo promedio/visita</Text>
            <Text style={styles.metricValue}>Sin dato</Text>
          </View>
          <Text style={[typography.dimSmall, { marginTop: 8, fontStyle: 'italic' }]}>
            V1: Metricas se calculan con datos acumulados de ventas reales.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpiCard: { flexBasis: '48%' },
  metricRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  metricLabel: { fontSize: 12, color: colors.textDim },
  metricValue: { fontSize: 13, fontWeight: '700', color: colors.text },
});
