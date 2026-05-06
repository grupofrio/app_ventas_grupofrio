/**
 * Checkout screen — s-checkout in mockup (lines 679-787).
 * Visit summary, next stop navigation. V2: WhatsApp previews removed.
 */

import React from 'react';
import { View, Text, ScrollView, Switch, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useVisitStore } from '../../src/stores/useVisitStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { formatElapsed, formatCurrency } from '../../src/utils/time';
import { buildCheckoutPayload } from '../../src/services/checkoutResult';
import { useLocationStore } from '../../src/stores/useLocationStore';
import { setGpsMode, captureAndEnqueueGpsPoint } from '../../src/services/gps';
import { checkOut } from '../../src/services/gfLogistics';
import { isRetryableSyncErrorMessage } from '../../src/utils/syncFailure';
import { shouldSkipStopCheckout } from '../../src/services/virtualStops';
import { getSaleSyncState } from '../../src/services/saleSyncState';
import { rearmSaleOrderForRetry } from '../../src/services/saleRetry';

export default function CheckoutScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
  const stop = stops.find((s) => s.id === Number(stopId));
  const updateStopState = useRouteStore((s) => s.updateStopState);
  const removeStop = useRouteStore((s) => s.removeStop);

  const {
    elapsedSeconds, saleTotal, saleTotalKg, salePhotoTaken,
    noSaleReasonId, saleOperationId, resetVisit,
  } = useVisitStore();

  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);
  const enqueue = useSyncStore((s) => s.enqueue);
  const isOnline = useSyncStore((s) => s.isOnline);
  const queue = useSyncStore((s) => s.queue);
  const processQueue = useSyncStore((s) => s.processQueue);

  const [sendEnCamino, setSendEnCamino] = React.useState(true);
  const [checkingOut, setCheckingOut] = React.useState(false); // Prevent double-tap
  const [retryingSale, setRetryingSale] = React.useState(false);

  // BLD-20260506-CHECKOUT-SALE-RETRY: live snapshot of the sale-order
  // sync state for THIS visit. Recomputed on every queue change so the
  // banner + button enabled-state reflect reality, not just the last
  // tap on "Confirmar".
  const liveSaleSyncState = React.useMemo(
    () => getSaleSyncState(saleOperationId, queue),
    [saleOperationId, queue],
  );

  // BLD-20260506-CHECKOUT-SALE-RETRY: retry handler that drives the
  // failed-sale recovery path. Steps:
  //   1. Reset retries + flip 'error' → 'pending' for THIS sale_order
  //      so processQueue picks it up. We touch the queue directly
  //      because the public API only allows markError/markDead, both
  //      of which are forward-only state machines.
  //   2. Run processQueue() once.
  //   3. Re-read the state. If 'done' → success. If still failed →
  //      keep banner visible.
  //
  // We do NOT auto-checkout after a successful retry — vendor still
  // confirms manually so they see the green Check-out button reappear.
  const retrySaleSync = React.useCallback(async () => {
    if (!saleOperationId) return;
    if (retryingSale) return;
    setRetryingSale(true);
    try {
      // Re-arm the failed sale_order so processQueue sees it as ready.
      // rearmSaleOrderForRetry is a pure helper — see saleRetry.ts.
      useSyncStore.setState((prev) => ({
        queue: rearmSaleOrderForRetry(prev.queue, saleOperationId),
      }));
      await processQueue();
      const after = getSaleSyncState(
        saleOperationId,
        useSyncStore.getState().queue,
      );
      if (after.status === 'failed') {
        Alert.alert(
          'Venta sigue sin sincronizar',
          after.message || 'Reintenta más tarde o contacta soporte.',
        );
      } else if (after.status === 'done') {
        // Quiet success — the banner disappears automatically because
        // liveSaleSyncState is reactive on queue.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      Alert.alert('Error al reintentar', message);
    } finally {
      setRetryingSale(false);
    }
  }, [saleOperationId, processQueue, retryingSale]);

  if (!stop) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar title="Check-out" showBack onBack={() => router.replace('/(tabs)/route' as never)} />
        <View style={styles.center}>
          <Text style={typography.dim}>Parada no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Next stop
  const currentIdx = stops.findIndex((s) => s.id === stop.id);
  const nextStop = stops.find((s, i) => i > currentIdx && s.state === 'pending');

  const total = saleTotal();
  const totalKg = saleTotalKg();

  function finalizeCheckout(shouldNavigateToNextStop: boolean) {
    captureAndEnqueueGpsPoint('checkout').catch(() => {});
    setGpsMode('in_transit');
    updateStopState(stop!.id, 'done');
    resetVisit();

    if (nextStop && shouldNavigateToNextStop) {
      router.replace(`/stop/${nextStop.id}` as never);
      return;
    }
    // BLD-20260427-P0-POST-SALE-RETURN-TO-ROUTE: post-cierre, regresar a Ruta
    // (no a Inicio). El vendedor mantiene el contexto del día y sus stops.
    // Alinea con el camino offroute (app/sale/[stopId].tsx L209) que ya iba a
    // /(tabs)/route. Antes: '/(tabs)' caía en (tabs)/index.tsx (Inicio).
    router.replace('/(tabs)/route' as never);
  }

  async function handleCheckout(shouldNavigateToNextStop: boolean) {
    if (!stop) return;
    if (checkingOut) return; // Guard: prevent double-tap
    setCheckingOut(true);

    let saleSyncState = getSaleSyncState(saleOperationId, queue);
    if (saleSyncState.status === 'pending' && isOnline) {
      await processQueue();
      saleSyncState = getSaleSyncState(saleOperationId, useSyncStore.getState().queue);
    }

    if (saleSyncState.status === 'pending') {
      Alert.alert(
        'Venta pendiente',
        'Espera a que la venta termine de sincronizar antes de cerrar la visita.',
      );
      setCheckingOut(false);
      return;
    }

    if (saleSyncState.status === 'failed') {
      // BLD-20260506-CHECKOUT-SALE-RETRY: ofrecer reintento operativo en
      // vez de dejar al vendedor atrapado con un Alert sin acción. El
      // mensaje técnico del backend se muestra para que el vendedor lo
      // pueda reportar a soporte si el reintento falla varias veces.
      Alert.alert(
        'Venta no sincronizada',
        `${saleSyncState.message || 'La venta no se pudo enviar a Odoo.'}\n\n¿Quieres reintentar la sincronización?`,
        [
          { text: 'Cancelar', style: 'cancel', onPress: () => setCheckingOut(false) },
          {
            text: 'Reintentar',
            onPress: async () => {
              setCheckingOut(false);
              await retrySaleSync();
            },
          },
        ],
      );
      return;
    }

    const lat = latitude || 0;
    const lon = longitude || 0;
    const checkoutPayload = buildCheckoutPayload({
      stopId: stop.id,
      latitude: lat,
      longitude: lon,
      saleTotal: total,
      noSaleReasonId,
    });

    if (shouldSkipStopCheckout(checkoutPayload.stop_id)) {
      removeStop(stop.id);
      finalizeCheckout(shouldNavigateToNextStop);
      return;
    }

    const enqueueCheckout = () => {
      enqueue('checkout', {
        ...checkoutPayload,
        timestamp: Date.now(),
      });
    };

    if (!isOnline) {
      enqueueCheckout();
      finalizeCheckout(shouldNavigateToNextStop);
      return;
    }

    try {
      await checkOut(
        checkoutPayload.stop_id,
        checkoutPayload.latitude,
        checkoutPayload.longitude,
        checkoutPayload.result_status,
      );
      finalizeCheckout(shouldNavigateToNextStop);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo completar el check-out.';
      if (isRetryableSyncErrorMessage(message)) {
        enqueueCheckout();
        Alert.alert(
          'Check-out pendiente',
          'No se pudo confirmar con el servidor. El cierre de visita quedo pendiente de sincronizacion.',
        );
        finalizeCheckout(shouldNavigateToNextStop);
        return;
      }

      Alert.alert('Check-out rechazado', message);
      setCheckingOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Check-out" showBack onBack={() => router.replace('/(tabs)/route' as never)} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* Success header */}
        <View style={styles.successHeader}>
          <Text style={{ fontSize: 44 }}>✅</Text>
          <Text style={styles.successTitle}>Visita completada</Text>
          <Text style={styles.successSub}>
            {stop.customer_name} · {formatElapsed(elapsedSeconds)}
          </Text>
        </View>

        {/* Visit summary card */}
        <Card>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Venta realizada</Text>
            <Text style={[styles.metricValue, { color: total > 0 ? colors.success : colors.textDim }]}>
              {total > 0 ? formatCurrency(total) : 'Sin venta'}
            </Text>
          </View>
          {totalKg > 0 && (
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>kg entregados</Text>
              <Text style={styles.metricValue}>{totalKg.toFixed(1)} kg</Text>
            </View>
          )}
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Foto de entrega</Text>
            {salePhotoTaken ? (
              <Badge label="✓ Capturada" variant="green" />
            ) : (
              <Badge label="Sin foto" variant="dim" />
            )}
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>GPS check-out</Text>
            <Badge
              label={latitude ? `✓ ${latitude.toFixed(4)}` : 'Sin GPS'}
              variant={latitude ? 'green' : 'dim'}
            />
          </View>
        </Card>

        {/* Next stop */}
        {nextStop && (
          <>
            <Text style={styles.sectionTitle}>📍 Siguiente parada</Text>
            <Card style={styles.nextStopCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <View style={styles.nextStopIcon}>
                  <Text style={{ fontSize: 20 }}>📍</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>
                    {nextStop.customer_name}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.textDim }}>
                    Siguiente en ruta
                  </Text>
                </View>
              </View>
              <View style={styles.toggleRow}>
                <Switch
                  value={sendEnCamino}
                  onValueChange={setSendEnCamino}
                  trackColor={{ true: colors.primary }}
                />
                <Text style={styles.toggleLabel}>
                  Enviar "voy en camino" a {nextStop.customer_name.split(' ')[0]}
                </Text>
              </View>
            </Card>
          </>
        )}

        {/* BLD-20260506-CHECKOUT-SALE-RETRY: banner persistente de venta
            no sincronizada. Aparece inmediatamente cuando la venta de
            esta visita está en error/dead, sin que el vendedor tenga que
            tocar Confirmar primero para descubrir el problema. Ofrece
            reintento sin perder la venta local ni el operation_id. */}
        {liveSaleSyncState.status === 'failed' && (
          <View style={styles.saleErrorBanner}>
            <Text style={styles.saleErrorTitle}>⚠️ Venta no sincronizada</Text>
            <Text style={styles.saleErrorBody}>
              {liveSaleSyncState.message || 'La venta no se pudo enviar a Odoo.'}
            </Text>
            <Text style={styles.saleErrorHint}>
              No puedes cerrar la visita hasta que la venta llegue al servidor.
              Reintenta cuando tengas mejor señal.
            </Text>
            <Button
              label={retryingSale ? 'Reintentando…' : '🔄 Reintentar sincronización'}
              variant="primary"
              onPress={() => { void retrySaleSync(); }}
              fullWidth
              disabled={retryingSale}
              loading={retryingSale}
              style={{ marginTop: 8 }}
            />
          </View>
        )}

        {liveSaleSyncState.status === 'pending' && (
          <View style={styles.salePendingBanner}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.salePendingText}>
              Sincronizando venta con Odoo…
            </Text>
          </View>
        )}

        {/* Confirm checkout */}
        <View style={{ marginTop: 10 }}>
          <Button
            label={nextStop
              ? '✓ Confirmar Check-out y Navegar al Siguiente'
              : '✓ Confirmar Check-out'}
            variant="success"
            onPress={() => handleCheckout(sendEnCamino)}
            fullWidth
            disabled={checkingOut || retryingSale || liveSaleSyncState.status === 'failed' || liveSaleSyncState.status === 'pending'}
            loading={checkingOut}
          />
          {nextStop && (
            <Button
              label="Cerrar visita y volver a Ruta"
              variant="secondary"
              onPress={() => handleCheckout(false)}
              fullWidth
              style={{ marginTop: 6 }}
              disabled={checkingOut || retryingSale || liveSaleSyncState.status === 'failed' || liveSaleSyncState.status === 'pending'}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  // Success header
  successHeader: { alignItems: 'center', paddingVertical: 16 },
  successTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 10 },
  successSub: { fontSize: 12, color: colors.textDim, marginTop: 3 },
  // Metric rows
  metricRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 7,
  },
  metricLabel: { fontSize: 12, color: colors.textDim, flex: 1 },
  metricValue: {
    fontFamily: fonts.monoBold, fontSize: 13, fontWeight: '700', color: colors.text,
  },
  // Section title
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  // Toggle
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6,
  },
  toggleLabel: { fontSize: 12, color: colors.textDim },
  // Next stop
  nextStopCard: {
    borderWidth: 1, borderColor: 'rgba(37,99,235,0.2)',
    backgroundColor: 'rgba(37,99,235,0.04)',
  },
  nextStopIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.successAlpha08,
    alignItems: 'center', justifyContent: 'center',
  },
  // BLD-20260506-CHECKOUT-SALE-RETRY
  saleErrorBanner: {
    marginTop: 14,
    padding: 14,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
    backgroundColor: 'rgba(239,68,68,0.07)',
  },
  saleErrorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#EF4444',
    marginBottom: 6,
  },
  saleErrorBody: {
    fontSize: 12,
    color: colors.text,
    marginBottom: 6,
    lineHeight: 17,
  },
  saleErrorHint: {
    fontSize: 11,
    color: colors.textDim,
    lineHeight: 15,
  },
  salePendingBanner: {
    marginTop: 14,
    padding: 12,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.3)',
    backgroundColor: 'rgba(37,99,235,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  salePendingText: {
    fontSize: 12,
    color: colors.text,
  },
});
