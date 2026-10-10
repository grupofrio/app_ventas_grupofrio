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
import { formatMexicoClock } from '../src/utils/localDate';
import { typography, fonts } from '../src/theme/typography';
import { useSyncStore } from '../src/stores/useSyncStore';
import { SyncQueueItem } from '../src/types/sync';
import { describeSyncQueueState } from '../src/services/syncStatusCopy';
import { describeSaleOrderItem } from '../src/services/pendingOrders';
import { describeProspectionSyncLabel } from '../src/services/prospectConvert';
import { describeRetryBlock } from '../src/services/trustSignals';
import { formatCurrency } from '../src/utils/time';
import { isProtectedPhysicalReviewItem } from '../src/services/consignmentPhysicalReview';
import { describeEvidencePhotoWarning } from '../src/services/evidencePhotoSync';
import { AlertBanner } from '../src/components/ui/AlertBanner';

const typeIcons: Record<string, string> = {
  sale_order: '🧾', checkin: '📍', checkout: '📍', photo: '📸',
  no_sale: '✕', payment: '💰', prospection: '📋', gps: '🛰',
};

const typeLabels: Record<string, string> = {
  sale_order: 'Venta', checkin: 'Check-in', checkout: 'Check-out',
  photo: 'Foto', no_sale: 'No venta', payment: 'Cobro',
  prospection: 'Prospecto', gps: 'GPS',
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
    processQueue, clearDone, clearDead, retryDeadPhoto, removeDeadQueueItems,
  } = useSyncStore();

  const pending = queue.filter((i) => i.status === 'pending' || i.status === 'syncing');
  const errors = queue.filter((i) => i.status === 'error');
  const dead = queue.filter((i) => i.status === 'dead');
  const backgroundLeadNotes = queue.filter((i) => i.type === 'lead_note' && i.status !== 'done');
  const visiblePending = pending.filter((i) => i.type !== 'lead_note').filter((i) => i.type !== 'gps');
  const visibleErrors = errors.filter((i) => i.type !== 'lead_note').filter((i) => i.type !== 'gps');
  const visibleDead = dead.filter((i) => i.type !== 'lead_note').filter((i) => i.type !== 'gps');
  const physicalReview = visibleDead.filter(isProtectedPhysicalReviewItem);
  const purgeableDead = visibleDead.filter((item) => !isProtectedPhysicalReviewItem(item));
  const done = queue.filter((i) => i.status === 'done' && i.type !== 'gps').slice(-10); // Last 10

  // P1: estado claro de la cola (sincronizado / sincronizando / pendiente / error).
  const syncCopy = describeSyncQueueState({ pendingCount, errorCount, deadCount, isSyncing, isOnline });
  const photoWarning = describeEvidencePhotoWarning(queue);
  const toneColor: Record<string, string> = {
    ok: '#22C55E', syncing: '#2563EB', pending: '#F59E0B', error: '#EF4444',
  };

  // BLD-20260424-PURGE: handler con confirmación. Los items dead suelen
  // ser residuos históricos (ventas viejas con shape obsoleto, GPS sin
  // red, etc.) que ya no van a sincronizar y solo ensucian el SyncBar.
  // La confirmación evita borrados accidentales.
  function handleClearDead() {
    if (purgeableDead.length === 0) {
      Alert.alert(
        'Revisión requerida',
        'Hay una consignación física pendiente de conciliación. No se puede borrar desde el historial.',
      );
      return;
    }
    Alert.alert(
      'Limpiar historial de errores',
      `Se eliminarán ${purgeableDead.length} operación(es) que fallaron permanentemente y ya no volverán a intentarse. Esta acción no se puede deshacer.\n\n¿Continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpiar',
          style: 'destructive',
          onPress: () => {
            const removed = clearDead();
            Alert.alert(
              'Historial limpio',
              `Se eliminaron ${removed} operación(es) fallidas. La alerta roja desaparecerá en cuanto se actualice la pantalla.`,
            );
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="🔄 Sincronizacion" showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* Status */}
        {photoWarning ? (
          <AlertBanner
            variant={photoWarning.tone === 'failed' ? 'critical' : 'warning'}
            icon="📸"
            message={photoWarning.message}
          />
        ) : null}

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
        {purgeableDead.length > 0 ? (
          <Button
            label={`🚮 Limpiar Historial de Errores (${purgeableDead.length})`}
            variant="danger"
            onPress={handleClearDead}
            fullWidth
            style={{ marginBottom: 14 }}
          />
        ) : (
          <View style={{ marginBottom: 6 }} />
        )}

        {backgroundLeadNotes.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>NOTAS AL PROSPECTO ({backgroundLeadNotes.length})</Text>
            <Text style={styles.deadHint}>
              Se reintentan solas en segundo plano. No bloquean el cierre de ruta ni el corte.
            </Text>
            {backgroundLeadNotes.map((item) => (
              <LeadNoteInfoItem key={item.id} item={item} />
            ))}
          </>
        )}

        {/* Pending */}
        {visiblePending.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>PENDIENTES ({visiblePending.length})</Text>
            {visiblePending.map((item) => (
              <SyncItem key={item.id} item={item} />
            ))}
          </>
        )}

        {/* Errors (con reintentos pendientes) */}
        {visibleErrors.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>CON ERROR ({visibleErrors.length})</Text>
            {visibleErrors.map((item) => (
              <SyncItem key={item.id} item={item} />
            ))}
          </>
        )}

        {/* BLD-20260424-PURGE: items DEAD agrupados por separado.
            Estos ya agotaron sus reintentos y no se van a sincronizar
            nunca más. Mostrarlos visibles motiva al operador a usar el
            botón de limpiar arriba. */}
        {physicalReview.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>REVISIÓN REQUERIDA ({physicalReview.length})</Text>
            <Text style={styles.deadHint}>
              La entrega física de consignación no fue confirmada por el servidor. No se puede borrar desde el historial: concíliala con Almacén.
            </Text>
            {physicalReview.map((item) => (
              <SyncItem key={item.id} item={item} />
            ))}
          </>
        )}

        {purgeableDead.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>FALLIDOS PERMANENTEMENTE ({purgeableDead.length})</Text>
            <Text style={styles.deadHint}>
              No se completarán solas: agotaron sus reintentos o dependían de una venta que falló. En una foto fallida puedes pulsar Reintentar. También puedes reintentar la venta desde su visita, o usar "Limpiar Historial" arriba.
            </Text>
            {purgeableDead.map((item) => (
              <SyncItem
                key={item.id}
                item={item}
                onRetryDeadPhoto={item.type === 'photo' ? () => {
                  const reason = retryDeadPhoto(item.id);
                  if (reason) Alert.alert('No se puede reintentar', reason);
                } : undefined}
                onDeleteDeadPhoto={item.type === 'photo' ? () => {
                  Alert.alert(
                    'Eliminar foto',
                    'Se quitará esta foto fallida de la cola. No se enviará a Odoo.',
                    [
                      { text: 'Cancelar', style: 'cancel' },
                      {
                        text: 'Eliminar',
                        style: 'destructive',
                        onPress: () => { removeDeadQueueItems([item.id]); },
                      },
                    ],
                  );
                } : undefined}
              />
            ))}
          </>
        )}

        {/* Done */}
        {done.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>COMPLETADOS (ultimos 10)</Text>
            {done.map((item) => (
              <SyncItem key={item.id} item={item} />
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
  onRetryDeadPhoto,
  onDeleteDeadPhoto,
}: {
  item: SyncQueueItem;
  onRetryDeadPhoto?: () => void;
  onDeleteDeadPhoto?: () => void;
}) {
  const icon = typeIcons[item.type] || '📦';
  const label = item.type === 'prospection'
    ? describeProspectionSyncLabel(item)
    : (typeLabels[item.type] || item.type);
  const orderDetail = describeSaleOrderItem(item);
  const badge = statusBadge[item.status] || statusBadge.pending;
  const physicalReview = isProtectedPhysicalReviewItem(item);
  // BLD-20260617-DEAD-CASCADE: un dependiente (p.ej. foto) que murió porque su
  // padre (la venta) falló. No debe parecer un pendiente normal: se explica la
  // causa real y se evita duplicar el mensaje en la línea de hora.
  const blockedByParent =
    item.status === 'dead' && !!item.dependsOn && item.dependsOn.length > 0;
  const time = formatMexicoClock(item.created_at);

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
            {orderDetail.priceConfirmationPending
              ? ' · Pendiente de confirmar por Odoo'
              : orderDetail.total != null
              ? ` · ${formatCurrency(orderDetail.total)}${orderDetail.tone === 'sent' ? '' : ' capturado'}`
              : ''}
          </Text>
        )}
        {blockedByParent && (
          <Text style={styles.syncBlockedLine}>
            ⚠ {item.error_message || 'No enviada: depende de una venta que falló'}. Reintenta la venta o limpia el historial de errores.
          </Text>
        )}
        {physicalReview && (
          <Text style={styles.syncBlockedLine}>
            ⚠ Entrega física pendiente de conciliación. No se revirtió el inventario local.
          </Text>
        )}
        <Text style={styles.syncTime}>
          {time}
          {item.retries > 0 ? ` · Intento ${item.retries}` : ''}
          {item.error_message && !blockedByParent ? ` · ${item.error_message}` : ''}
        </Text>
        {(onRetryDeadPhoto || onDeleteDeadPhoto) && (
          <View style={styles.photoActions}>
            {onRetryDeadPhoto ? (
              <Button label="Reintentar" small onPress={onRetryDeadPhoto} />
            ) : null}
            {onDeleteDeadPhoto ? (
              <Button label="Eliminar" variant="danger" small onPress={onDeleteDeadPhoto} />
            ) : null}
          </View>
        )}
      </View>
      <Badge label={physicalReview ? 'Revisión' : badge.label} variant={physicalReview ? 'red' : badge.variant} />
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
  photoActions: { flexDirection: 'row', gap: 6, marginTop: 8 },
  deadHint: {
    fontSize: 11, color: colors.textDim, fontStyle: 'italic',
    marginBottom: 8, lineHeight: 15,
  },
  emptyCard: {
    backgroundColor: colors.card, borderRadius: radii.card,
    padding: 30, alignItems: 'center', marginTop: 20,
  },
});

function LeadNoteInfoItem({ item }: { item: SyncQueueItem }) {
  const time = formatMexicoClock(item.created_at);

  return (
    <View style={styles.syncItem}>
      <View style={[styles.syncIcon, styles.iconPending]}>
        <Text style={{ fontSize: 16 }}>📝</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.syncLabel}>Nota al prospecto</Text>
        <Text style={styles.syncTime}>
          {time} · Informativa. Se reintenta en segundo plano.
        </Text>
      </View>
      <Badge label="Informativa" variant="dim" />
    </View>
  );
}
