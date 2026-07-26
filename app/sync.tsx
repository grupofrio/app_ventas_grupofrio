/**
 * Sync screen — queue visibility and management.
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { Badge } from '../src/components/ui/Badge';
import { colors, spacing, radii } from '../src/theme/tokens';
import { typography, fonts } from '../src/theme/typography';
import { useSyncStore } from '../src/stores/useSyncStore';
import { SyncQueueItem } from '../src/types/sync';
import { describeSyncQueueState } from '../src/services/syncStatusCopy';
import { describeSaleOrderItem } from '../src/services/pendingOrders';
import { describeRetryBlock } from '../src/services/trustSignals';
import { formatCurrency } from '../src/utils/time';
import { isProtectedStockSyncItem } from '../src/services/syncErrorClassification';
import { isRetryableProtectedSaleOrder } from '../src/services/saleRetry';

const typeIcons: Record<string, string> = {
  sale_order: '🧾', checkin: '📍', checkout: '📍', photo: '📸',
  no_sale: '✕', payment: '💰', prospection: '📋', gps: '🛰',
};

const typeLabels: Record<string, string> = {
  sale_order: 'Venta', checkin: 'Check-in', checkout: 'Check-out',
  photo: 'Foto', no_sale: 'No venta', payment: 'Cobro',
  prospection: 'Operacion', gps: 'GPS',
};

const statusBadge: Record<string, { label: string; variant: 'yellow' | 'green' | 'red' | 'orange' | 'dim' }> = {
  pending: { label: 'Pendiente', variant: 'yellow' },
  syncing: { label: 'Sincronizando', variant: 'orange' },
  done: { label: '✓ Listo', variant: 'green' },
  error: { label: 'Error', variant: 'red' },
  dead: { label: 'Fallido', variant: 'dim' },
};

export default function SyncScreen() {
  const {
    queue, isOnline, isSyncing, pendingCount, errorCount, deadCount,
    processQueue, clearDone, clearDead, retrySaleOrder,
  } = useSyncStore();
  const [retryingOperationId, setRetryingOperationId] = React.useState<string | null>(null);

  const pending = queue.filter((i) => i.status === 'pending' || i.status === 'syncing');
  const errors = queue.filter((i) => i.status === 'error');
  const dead = queue.filter((i) => i.status === 'dead');
  const clearableDeadCount = dead.filter((item) => !isProtectedStockSyncItem(item)).length;
  const protectedStockDeadCount = dead.length - clearableDeadCount;
  const done = queue.filter((i) => i.status === 'done').slice(-10); // Last 10

  // P1: estado claro de la cola (sincronizado / sincronizando / pendiente / error).
  const syncCopy = describeSyncQueueState({ pendingCount, errorCount, deadCount, isSyncing, isOnline });
  const toneColor: Record<string, string> = {
    ok: '#22C55E', syncing: '#2563EB', pending: '#F59E0B', error: '#EF4444',
  };

  // BLD-20260424-PURGE: handler con confirmación. Los items dead suelen
  // ser residuos históricos (ventas viejas con shape obsoleto, GPS sin
  // red, etc.) que ya no van a sincronizar y solo ensucian el SyncBar.
  // La confirmación evita borrados accidentales.
  function handleClearDead() {
    if (clearableDeadCount === 0) return;
    Alert.alert(
      'Limpiar historial de errores',
      `Se eliminarán ${clearableDeadCount} operación(es) que fallaron permanentemente. Las ventas rechazadas por stock insuficiente permanecerán protegidas (${protectedStockDeadCount}). Esta acción no se puede deshacer.\n\n¿Continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpiar',
          style: 'destructive',
          onPress: () => {
            const { removed, protected: protectedCount } = clearDead();
            Alert.alert(
              'Historial limpio',
              `Se eliminaron ${removed} operación(es) fallidas. Permanecen ${protectedCount} venta(s) rechazadas por stock que requieren atención.`,
            );
          },
        },
      ],
    );
  }

  async function handleRetryProtectedSale(operationId: string) {
    if (!isOnline || retryingOperationId !== null) return;
    setRetryingOperationId(operationId);
    try {
      await retrySaleOrder(operationId);
    } catch (error) {
      Alert.alert(
        'No se pudo reintentar',
        error instanceof Error ? error.message : 'Intenta nuevamente con conexión.',
      );
    } finally {
      setRetryingOperationId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="🔄 Sincronizacion" showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* Status */}
        <View style={[styles.statusBar, isOnline ? styles.online : styles.offline]}>
          <Text style={styles.statusText}>
            {isOnline ? '🟢 En linea' : '🟡 Sin conexion'}
            {pendingCount > 0 ? ` · ${pendingCount} pendientes` : ''}
            {errorCount > 0 ? ` · ${errorCount} errores` : ''}
          </Text>
        </View>

        {/* P1: resumen claro del estado de la cola */}
        <View style={[styles.summaryCard, { borderColor: toneColor[syncCopy.tone] }]}>
          <View style={[styles.summaryDot, { backgroundColor: toneColor[syncCopy.tone] }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryLabel}>{syncCopy.label}</Text>
            <Text style={styles.summaryDetail}>{syncCopy.detail}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
          <Button
            label="🔄 Reintentar"
            variant="primary"
            small
            onPress={() => processQueue()}
            disabled={!isOnline || pendingCount === 0}
            style={{ flex: 1 }}
          />
          <Button
            label="🗑 Limpiar completados"
            variant="secondary"
            small
            onPress={() => clearDone()}
            style={{ flex: 1 }}
          />
        </View>
        {/* Razón visible de por qué "Reintentar" no está disponible. */}
        {(() => {
          const retryReason = describeRetryBlock({ isOnline, pendingCount, isSyncing });
          return retryReason ? <Text style={styles.retryHint}>{retryReason}</Text> : null;
        })()}

        {/* BLD-20260424-PURGE: botón visible y diferenciado para limpiar
            items DEAD. Solo aparece cuando hay items fallidos permanentemente
            para no añadir ruido cuando la cola está sana. */}
        {clearableDeadCount > 0 ? (
          <Button
            label={`🚮 Limpiar Historial de Errores (${clearableDeadCount})`}
            variant="danger"
            onPress={handleClearDead}
            fullWidth
            style={{ marginBottom: 14 }}
          />
        ) : (
          <View style={{ marginBottom: 6 }} />
        )}

        {/* Pending */}
        {pending.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>PENDIENTES ({pending.length})</Text>
            {pending.map((item) => (
              <SyncItem
                key={item.id}
                item={item}
                isOnline={isOnline}
                retrying={retryingOperationId === item.id}
                onRetry={handleRetryProtectedSale}
              />
            ))}
          </>
        )}

        {/* Errors (con reintentos pendientes) */}
        {errors.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>CON ERROR ({errors.length})</Text>
            {errors.map((item) => (
              <SyncItem
                key={item.id}
                item={item}
                isOnline={isOnline}
                retrying={retryingOperationId === item.id}
                onRetry={handleRetryProtectedSale}
              />
            ))}
          </>
        )}

        {/* BLD-20260424-PURGE: items DEAD agrupados por separado.
            Estos ya agotaron sus reintentos y no se van a sincronizar
            nunca más. Mostrarlos visibles motiva al operador a usar el
            botón de limpiar arriba. */}
        {dead.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>FALLIDOS PERMANENTEMENTE ({dead.length})</Text>
            <Text style={styles.deadHint}>
              Las ventas rechazadas por stock permanecen protegidas hasta que las reintentes con conexión. Los demás fallos permanentes sí pueden retirarse con "Limpiar Historial".
            </Text>
            {dead.map((item) => (
              <SyncItem
                key={item.id}
                item={item}
                isOnline={isOnline}
                retrying={retryingOperationId === item.id}
                onRetry={handleRetryProtectedSale}
              />
            ))}
          </>
        )}

        {/* Done */}
        {done.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>COMPLETADOS (ultimos 10)</Text>
            {done.map((item) => (
              <SyncItem
                key={item.id}
                item={item}
                isOnline={isOnline}
                retrying={retryingOperationId === item.id}
                onRetry={handleRetryProtectedSale}
              />
            ))}
          </>
        )}

        {/* Empty */}
        {queue.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>✅</Text>
            <Text style={typography.body}>Cola vacia</Text>
            <Text style={[typography.dimSmall, { marginTop: 4 }]}>
              Todas las operaciones sincronizadas
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SyncItem({
  item,
  isOnline,
  retrying,
  onRetry,
}: {
  item: SyncQueueItem;
  isOnline: boolean;
  retrying: boolean;
  onRetry: (operationId: string) => Promise<void>;
}) {
  const icon = typeIcons[item.type] || '📦';
  const label = typeLabels[item.type] || item.type;
  const orderDetail = describeSaleOrderItem(item);
  const requiresStockRetry = isRetryableProtectedSaleOrder(item);
  const badge = requiresStockRetry
    ? { label: 'Requiere atención', variant: 'red' as const }
    : statusBadge[item.status] || statusBadge.pending;
  // BLD-20260617-DEAD-CASCADE: un dependiente (p.ej. foto) que murió porque su
  // padre (la venta) falló. No debe parecer un pendiente normal: se explica la
  // causa real y se evita duplicar el mensaje en la línea de hora.
  const blockedByParent =
    item.status === 'dead' && !!item.dependsOn && item.dependsOn.length > 0;
  const time = new Date(item.created_at).toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <View style={styles.syncItem}>
      <View style={[styles.syncIcon, item.status === 'done' ? styles.iconDone : styles.iconPending]}>
        <Text style={{ fontSize: 16 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.syncLabel}>{orderDetail ? orderDetail.statusLabel : label}</Text>
        {orderDetail && (orderDetail.customerName || orderDetail.total != null) && (
          <Text style={styles.syncOrderLine}>
            {orderDetail.customerName ?? 'Cliente'}
            {orderDetail.total != null
              ? ` · ${formatCurrency(orderDetail.total)}${orderDetail.tone === 'sent' ? '' : ' capturado'}`
              : ''}
          </Text>
        )}
        {blockedByParent && (
          <Text style={styles.syncBlockedLine}>
            ⚠ {item.error_message || 'No enviada: depende de una venta que falló'}. Reintenta la venta o limpia el historial de errores.
          </Text>
        )}
        <Text style={styles.syncTime}>
          {time}
          {item.retries > 0 ? ` · Intento ${item.retries}/3` : ''}
          {item.error_message && !blockedByParent ? ` · ${item.error_message}` : ''}
        </Text>
        {requiresStockRetry && isOnline ? (
          <Button
            label={retrying ? 'Reintentando…' : 'Reintentar'}
            variant="primary"
            small
            onPress={() => { void onRetry(item.id); }}
            disabled={retrying}
            loading={retrying}
            style={{ marginTop: 8 }}
          />
        ) : null}
      </View>
      <Badge label={badge.label} variant={badge.variant} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  statusBar: {
    padding: 10, borderRadius: radii.button, alignItems: 'center',
    marginBottom: 14, borderWidth: 1,
  },
  online: { backgroundColor: colors.successAlpha08, borderColor: 'rgba(34,197,94,0.15)' },
  offline: { backgroundColor: colors.warningAlpha08, borderColor: 'rgba(245,158,11,0.15)' },
  statusText: { fontSize: 12, fontWeight: '600', color: colors.text },
  summaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: radii.button, borderWidth: 1,
    backgroundColor: colors.card, marginBottom: 14,
  },
  summaryDot: { width: 12, height: 12, borderRadius: 6 },
  summaryLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  summaryDetail: { fontSize: 12, color: colors.textDim, marginTop: 2, lineHeight: 16 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  syncItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, backgroundColor: colors.card, borderRadius: radii.button, marginBottom: 6,
  },
  syncIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  iconPending: { backgroundColor: colors.warningAlpha12 },
  iconDone: { backgroundColor: colors.successAlpha12 },
  syncLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  syncOrderLine: { fontSize: 12, color: colors.text, fontWeight: '500', marginTop: 1 },
  syncBlockedLine: { fontSize: 12, color: '#EF4444', fontWeight: '500', marginTop: 2, lineHeight: 16 },
  retryHint: { fontSize: 11, color: colors.textDim, marginBottom: 8, marginTop: -2 },
  syncTime: { fontSize: 11, color: colors.textDim },
  deadHint: {
    fontSize: 11, color: colors.textDim, fontStyle: 'italic',
    marginBottom: 8, lineHeight: 15,
  },
  emptyCard: {
    backgroundColor: colors.card, borderRadius: radii.card,
    padding: 30, alignItems: 'center', marginTop: 20,
  },
});
