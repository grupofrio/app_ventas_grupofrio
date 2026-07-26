/**
 * Sales tab — s-sales in mockup (lines 469-491).
 * Daily sales summary, KPIs, order list.
 */

import React, { useCallback } from 'react';
import {
  Alert,
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Badge } from '../../src/components/ui/Badge';
import { KPICard } from '../../src/components/ui/KPICard';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useSalesStore } from '../../src/stores/useSalesStore';
import { useSalesListProjection } from '../../src/hooks/useSalesListProjection';
import { formatCurrency } from '../../src/utils/time';
import { GFSalesOrder } from '../../src/services/gfLogistics';
import type { SalesListEntry } from '../../src/services/salesListProjection';
import { getSaleStatusCopy } from '../../src/services/localSaleStatusCopy';
import { createSaleTicketOpenGuard } from '../../src/services/saleTicket';
import { openSaleTicketForOrder } from '../../src/services/saleTicketOpen';
import {
  loadSaleTicketSnapshotStrict,
  saveSaleTicketSnapshot,
} from '../../src/services/saleTicketStorage';
import { useSyncStore } from '../../src/stores/useSyncStore';

function showTicketOpenError() {
  console.error('[sales] No se pudo abrir el ticket');
  Alert.alert(
    'No se pudo abrir el ticket',
    'Intenta nuevamente. Permanecerás en la pantalla de Ventas.',
  );
}

export default function SalesScreen() {
  const router = useRouter();
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);
  const summary = useSalesStore((s) => s.summary);
  const isLoading = useSalesStore((s) => s.isLoading);
  const error = useSalesStore((s) => s.error);
  const { entries, localSummary, ticketsLoading } = useSalesListProjection();
  const isOnline = useSyncStore((s) => s.isOnline);
  const retrySaleOrder = useSyncStore((s) => s.retrySaleOrder);
  const ticketOpenGuardRef = React.useRef(createSaleTicketOpenGuard());
  const retryingSalesRef = React.useRef(new Set<string>());
  const [retryingOperationId, setRetryingOperationId] = React.useState<string | null>(null);

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
    const ticketKey = order.operation_id.trim() || `odoo-order-${order.id}`;
    await ticketOpenGuardRef.current.run(ticketKey, async () => {
      await openSaleTicketForOrder(order, {
        load: loadSaleTicketSnapshotStrict,
        save: saveSaleTicketSnapshot,
        navigate: (saleId) => {
          const ticketId = encodeURIComponent(saleId);
          router.push(`/print/${ticketId}` as never);
        },
        onError: showTicketOpenError,
      });
    });
  }

  async function openTicketForEntry(entry: SalesListEntry) {
    if (entry.origin === 'local') {
      if (!entry.ticketSnapshot) {
        Alert.alert(
          'Ticket no disponible',
          'El comprobante de esta venta aún no está disponible en el dispositivo.',
        );
        return;
      }
      const normalizedOperationId = entry.ticketSnapshot.saleId.trim();
      if (!normalizedOperationId) {
        Alert.alert(
          'Ticket no disponible',
          'Esta venta no tiene un identificador válido para abrir su comprobante.',
        );
        return;
      }
      const ticketId = encodeURIComponent(normalizedOperationId);
      router.push(`/print/${ticketId}` as never);
      return;
    }

    if (entry.remoteOrder) {
      await openTicketForOrder(entry.remoteOrder);
      return;
    }

    Alert.alert(
      'Ticket no disponible',
      'No encontramos la información necesaria para abrir este comprobante.',
    );
  }

  const refreshOfficialSales = useCallback(() => {
    void loadTodaySales({ force: true });
  }, [loadTodaySales]);

  async function retryProtectedSale(entry: SalesListEntry) {
    if (
      !isOnline
      || entry.origin !== 'local'
      || entry.requiresStockRetry !== true
      || retryingSalesRef.current.has(entry.operationId)
    ) {
      return;
    }
    retryingSalesRef.current.add(entry.operationId);
    setRetryingOperationId(entry.operationId);
    try {
      await retrySaleOrder(entry.operationId);
    } catch {
      Alert.alert(
        'No se pudo reintentar',
        'No pudimos reintentar la venta. Intenta nuevamente con conexión.',
      );
    } finally {
      retryingSalesRef.current.delete(entry.operationId);
      setRetryingOperationId((current) => (
        current === entry.operationId ? null : current
      ));
    }
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

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refreshOfficialSales}
            tintColor={colors.primary}
          />
        )}
      >
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

        {localSummary.count > 0 ? (
          <View style={styles.pendingCard}>
            <View style={styles.pendingHeader}>
              <Text style={styles.pendingTitle}>VENTAS PENDIENTES</Text>
              <Badge label={`${localSummary.count}`} variant="yellow" />
            </View>
            <Text style={styles.pendingAmount}>
              {localSummary.unknownAmountCount > 0 ? 'Monto conocido' : 'Monto pendiente'}:{' '}
              {formatCurrency(localSummary.knownAmountTotal)}
            </Text>
            {localSummary.unknownAmountCount > 0 ? (
              <Text style={styles.pendingMeta}>
                {localSummary.unknownAmountCount} con monto por confirmar
              </Text>
            ) : null}
            {localSummary.needsAttentionCount > 0 ? (
              <Text style={styles.attentionText}>
                {localSummary.needsAttentionCount} requieren atención
              </Text>
            ) : null}
            <Text style={styles.pendingHint}>
              No se suman a VENDIDO hasta que Odoo las confirme.
            </Text>
          </View>
        ) : null}

        {/* Orders list */}
        <Text style={styles.sectionTitle}>PEDIDOS</Text>
        {ticketsLoading ? (
          <Text style={styles.loadingHint}>Preparando comprobantes…</Text>
        ) : null}
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>No se pudo actualizar Odoo</Text>
            <Text style={styles.errorText}>
              Las ventas guardadas en este dispositivo siguen disponibles.
            </Text>
          </View>
        ) : null}
        {entries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={typography.dim}>
              {isLoading ? 'Actualizando ventas…' : 'Sin pedidos registrados hoy'}
            </Text>
            <Text style={[typography.dimSmall, { marginTop: 4 }]}>
              Las ventas aparecen aqui al confirmar pedidos
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {entries.map((entry) => {
              const status = getSaleStatusCopy(
                entry.origin === 'odoo'
                  ? 'synced'
                  : entry.localStatus ?? 'unknown',
              );
              const ticketUnavailable =
                entry.origin === 'local' && !entry.ticketSnapshot;
              return (
                <View
                  key={entry.key}
                  style={styles.orderCard}
                >
                  <TouchableOpacity
                    style={ticketUnavailable ? styles.orderCardDisabled : undefined}
                    onPress={() => void openTicketForEntry(entry)}
                    disabled={entry.origin === 'local' && !entry.ticketSnapshot}
                    activeOpacity={0.82}
                  >
                    <View style={styles.orderRow}>
                      <Text style={styles.orderName}>
                        {entry.remoteOrder?.name || 'Venta local'}
                      </Text>
                      <Text style={[
                        styles.orderAmount,
                        entry.amountTotal === null ? styles.orderAmountPending : null,
                      ]}>
                        {entry.amountTotal === null
                          ? 'Monto pendiente'
                          : formatCurrency(entry.amountTotal)}
                      </Text>
                    </View>
                    <Text style={styles.orderMeta}>
                      {entry.customerName} · {entry.kgTotal === null
                        ? 'Peso por confirmar'
                        : `${entry.kgTotal.toFixed(0)} kg`}
                    </Text>
                    <View style={styles.badgeRow}>
                      <Badge
                        label={entry.origin === 'local' ? 'Local' : 'Odoo'}
                        variant={entry.origin === 'local' ? 'yellow' : 'green'}
                      />
                      <Badge label={status.label} variant={status.tone} />
                    </View>
                    <Text style={styles.statusDetail}>{status.detail}</Text>
                    {entry.errorMessage ? (
                      <Text style={styles.entryError}>
                        {entry.errorMessage.slice(0, 200)}
                      </Text>
                    ) : null}
                    <Text style={[
                      styles.orderHint,
                      ticketUnavailable ? styles.orderHintDisabled : null,
                    ]}>
                      {ticketUnavailable
                        ? 'Ticket no disponible'
                        : 'Toca para abrir PDF'}
                    </Text>
                  </TouchableOpacity>
                  {entry.requiresStockRetry && isOnline ? (
                    <Button
                      label={retryingOperationId === entry.operationId
                        ? 'Reintentando…'
                        : 'Reintentar'}
                      variant="primary"
                      small
                      onPress={() => { void retryProtectedSale(entry); }}
                      disabled={retryingOperationId === entry.operationId}
                      loading={retryingOperationId === entry.operationId}
                      style={{ marginTop: 8 }}
                    />
                  ) : null}
                </View>
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
  progressBar: {
    height: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', borderRadius: 4,
    backgroundColor: colors.primary,
  },
  progressText: { fontSize: 10, color: colors.textDim, textAlign: 'center', marginBottom: 14 },
  pendingCard: {
    backgroundColor: colors.warningAlpha08,
    borderColor: colors.warningAlpha12,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 4,
  },
  pendingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  pendingTitle: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  pendingAmount: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
  },
  pendingMeta: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  attentionText: { color: colors.error, fontSize: 11, fontWeight: '700', marginTop: 3 },
  pendingHint: { color: colors.textDim, fontSize: 10, marginTop: 7 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  emptyCard: {
    backgroundColor: colors.card, borderRadius: radii.card, padding: 20, alignItems: 'center',
  },
  list: { gap: 8 },
  loadingHint: { color: colors.textDim, fontSize: 11, marginBottom: 8 },
  errorCard: {
    backgroundColor: colors.errorAlpha08,
    borderRadius: radii.card,
    padding: 12,
    marginBottom: 8,
  },
  errorTitle: { color: colors.error, fontSize: 12, fontWeight: '700' },
  errorText: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  orderCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 14,
  },
  orderCardDisabled: { opacity: 0.72 },
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
  orderAmountPending: {
    color: colors.warning,
    fontSize: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  statusDetail: { color: colors.textDim, fontSize: 10, marginTop: 5 },
  entryError: { color: colors.error, fontSize: 10, marginTop: 4 },
  orderHint: {
    marginTop: 8,
    fontSize: 11,
    color: colors.primary,
    fontWeight: '700',
  },
  orderHintDisabled: { color: colors.textDim },
});
