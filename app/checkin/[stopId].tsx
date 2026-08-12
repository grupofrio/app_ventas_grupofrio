/**
 * V1.3.1 Check-in screen — with real geofence validation.
 * Blocks check-in if vendor is outside 50m radius.
 * Shows GPS status, distance, and clear feedback.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Linking } from 'react-native';
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
import { useLocationStore } from '../../src/stores/useLocationStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { formatElapsed } from '../../src/utils/time';
import { checkIn, closeOffrouteVisit } from '../../src/services/gfLogistics';
import { getCurrentPosition, setGpsMode, captureAndEnqueueGpsPoint } from '../../src/services/gps';
import { deriveVisitGuard } from '../../src/services/visitGuards';
import { buildStopNavigationUrls } from '../../src/services/locationNavigation';
import { formatCustomerAddress } from '../../src/services/formatCustomerAddress';
import { isRetryableSyncErrorMessage } from '../../src/utils/syncFailure';
import { getLeadActionVisibility } from '../../src/services/leadVisit';
import { useNavigationStore } from '../../src/stores/useNavigationStore';

const GEOFENCE_RADIUS_M = 50;

export default function CheckinScreen() {
  const {
    stopId,
    exchangeMessage,
    giftSuccess,
  } = useLocalSearchParams<{ stopId: string; exchangeMessage?: string; giftSuccess?: string }>();
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
  const updateStopState = useRouteStore((s) => s.updateStopState);
  const stop = stops.find((s) => s.id === Number(stopId));

  const {
    phase, currentStopId, checkInTime, elapsedSeconds,
    startVisit, tickTimer, offrouteVisitId,
  } = useVisitStore();

  const {
    latitude, longitude, distanceMeters, isWithinFence,
    status: locStatus, errorMessage: locError,
    setLocation, setTarget, setStatus,
  } = useLocationStore();

  const enqueue = useSyncStore((s) => s.enqueue);
  const isOnline = useSyncStore((s) => s.isOnline);
  const allowOffDistanceVisits = useAuthStore((s) => s.allowOffDistanceVisits);
  const activeVisitForStop = currentStopId === Number(stopId)
    && (phase === 'checked_in' || phase === 'selling' || phase === 'no_selling');

  // BLD-20260426: Auto-restore orphaned in_progress visits.
  // If the stop is in_progress but the visit store has no record (app kill,
  // failed rehydration), re-adopt the visit so the user sees the post-checkin
  // screen and can continue working.
  const isOrphanedInProgress =
    stop?.state === 'in_progress' && !activeVisitForStop && phase === 'idle';
  useEffect(() => {
    if (isOrphanedInProgress && stop) {
      const lat = latitude || 0;
      const lon = longitude || 0;
      startVisit(stop, lat, lon);
    }
  }, [isOrphanedInProgress, stop?.id]);

  const [gpsLoading, setGpsLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false); // Prevent double-tap
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const handledFlashMessageRef = useRef<string | null>(null);
  const isOffrouteVisit = !!stop?._isOffroute;

  useEffect(() => {
    const nextMessage = typeof giftSuccess === 'string' && giftSuccess.trim().length > 0
      ? giftSuccess
      : exchangeMessage;
    if (typeof nextMessage !== 'string' || nextMessage.trim().length === 0) return;
    if (handledFlashMessageRef.current === nextMessage) return;
    handledFlashMessageRef.current = nextMessage;
    setFlashMessage(nextMessage);
    const timeout = setTimeout(() => setFlashMessage(null), 2500);
    return () => clearTimeout(timeout);
  }, [exchangeMessage, giftSuccess]);

  // Timer tick
  useEffect(() => {
    if (activeVisitForStop) {
      const interval = setInterval(() => tickTimer(), 1000);
      return () => clearInterval(interval);
    }
  }, [activeVisitForStop]);

  // Get GPS and set target on mount
  useEffect(() => {
    if (!stop) return;

    // Set geofence target
    setTarget(stop.customer_latitude, stop.customer_longitude);

    // Request GPS. Do not run the full GPS initialization here; check-in must
    // never hang on a fresh high-accuracy location request.
    (async () => {
      setGpsLoading(true);
      try {
        const pos = await getCurrentPosition();
        if (pos) {
          setLocation(pos.latitude, pos.longitude, pos.accuracy || 0);
        } else {
          setStatus('error', 'No se pudo obtener ubicacion');
        }
      } catch {
        setStatus('error', 'Error obteniendo GPS');
      }
      setGpsLoading(false);
    })();
  }, [stop?.id]);

  // Check-in handler — only if geofence OK
  async function handleCheckIn() {
    if (!stop || checkingIn) return; // Guard: prevent double-tap
    const visitGuard = deriveVisitGuard({
      stopState: stop.state,
      stopId: stop.id,
      currentStopId,
      phase,
    });
    if (!visitGuard.canStartVisit) {
      if (visitGuard.isCompletedStop) {
        Alert.alert('Visita cerrada', 'Esta parada ya no permite iniciar una visita nueva.');
      } else if (visitGuard.hasAnotherActiveVisit) {
        Alert.alert('Visita activa', 'Primero termina la visita que ya está en curso.');
      }
      return;
    }
    if (!allowOffDistanceVisits && !isWithinFence && stop.customer_latitude && stop.customer_longitude) {
      Alert.alert(
        'Fuera de rango',
        `Estás a ${Math.round(distanceMeters || 0)}m del cliente. Debes estar a menos de ${GEOFENCE_RADIUS_M}m para hacer check-in.`,
        [{ text: 'Entendido' }]
      );
      return;
    }

    // Quick win (hardening): no registrar check-in con ubicación inválida (0,0 /
    // sin fix) cuando el cliente tiene coordenadas y no hay override. Falsear la
    // posición rompe la geocerca y la trazabilidad. Clientes sin coordenadas
    // siguen permitidos (check-in libre).
    const clientHasCoords = !!(stop.customer_latitude && stop.customer_longitude);
    const hasValidFix =
      latitude != null && longitude != null && !(latitude === 0 && longitude === 0);
    if (clientHasCoords && !hasValidFix && !allowOffDistanceVisits) {
      Alert.alert(
        'Ubicación no disponible',
        'Activa el GPS/permiso de ubicación para hacer check-in con este cliente.',
      );
      return;
    }

    setCheckingIn(true); // Lock immediately

    const lat = latitude || 0;
    const lon = longitude || 0;
    const startLocalVisit = (queueForSync: boolean) => {
      useNavigationStore.getState().stopNavigation();
      startVisit(stop, lat, lon);
      updateStopState(stop.id, 'in_progress');
      setGpsMode('in_visit');
      captureAndEnqueueGpsPoint('checkin').catch(() => {});
      if (queueForSync) {
        enqueue('checkin', {
          stop_id: stop.id,
          latitude: lat,
          longitude: lon,
          timestamp: Date.now(),
        });
      }
    };

    if (!isOnline) {
      startLocalVisit(true);
      return;
    }

    try {
      await checkIn(stop.id, lat, lon);
      startLocalVisit(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo realizar el check-in.';
      if (isRetryableSyncErrorMessage(message)) {
        startLocalVisit(true);
        Alert.alert(
          'Check-in pendiente',
          'No se pudo confirmar con el servidor. La visita quedo pendiente de sincronizacion.',
        );
        return;
      }

      Alert.alert('Check-in rechazado', message);
      setCheckingIn(false);
    }
    // checkingIn stays true after success — screen transitions to post-checkin state
  }

  function handleOpenLocation() {
    // BLD-20260424-STAB: el botón que invoca esta función solo se renderiza
    // cuando `stop` existe, pero TypeScript no puede inferirlo desde la
    // closure. Guard explícito para mantener tipos limpios y evitar crash
    // en la rama imposible.
    if (!stop) return;
    const { primaryUrl, fallbackUrl } = buildStopNavigationUrls(stop);
    if (!primaryUrl) {
      Alert.alert('Sin ubicación', 'Esta parada no tiene ubicación disponible.');
      return;
    }

    Linking.openURL(primaryUrl).catch(() => {
      if (fallbackUrl) {
        Linking.openURL(fallbackUrl).catch(() => {
          Alert.alert('Error', 'No se pudo abrir la ubicación.');
        });
        return;
      }
      Alert.alert('Error', 'No se pudo abrir la ubicación.');
    });
  }

  function handleCloseSpecialVisit() {
    if (!stop || !stop._isOffroute) return;
    Alert.alert(
      'Cerrar visita especial',
      'Esta visita especial solo existe localmente en la app. Se cerrará y ya podrás abrir otra visita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar visita',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const closePayload = offrouteVisitId
                ? {
                    visit_id: offrouteVisitId,
                    result_status: 'cancelled' as const,
                    latitude: latitude || 0,
                    longitude: longitude || 0,
                  }
                : null;
              if (closePayload) {
                if (!isOnline) {
                  enqueue('offroute_visit_close', {
                    ...closePayload,
                    timestamp: Date.now(),
                  });
                } else {
                  try {
                    await closeOffrouteVisit(closePayload);
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'No se pudo cerrar la visita especial.';
                    if (isRetryableSyncErrorMessage(message)) {
                      enqueue('offroute_visit_close', {
                        ...closePayload,
                        timestamp: Date.now(),
                      });
                    } else {
                      Alert.alert(
                        'Cierre pendiente en servidor',
                        'La visita especial se cerrará solo localmente porque backend rechazó el cierre.',
                      );
                    }
                  }
                }
              }
              useRouteStore.getState().removeStop(stop.id);
              useVisitStore.getState().resetVisit();
              setGpsMode('in_transit');
              router.replace('/(tabs)' as never);
            })();
          },
        },
      ],
    );
  }

  if (!stop) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar title="Visita" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>Parada no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  const visitGuard = deriveVisitGuard({
    stopState: stop.state,
    stopId: stop.id,
    currentStopId,
    phase,
  });
  const checkedIn = activeVisitForStop;
  const actionVisibility = getLeadActionVisibility(stop);
  const showCollect = stop._entityType !== 'lead';

  const address = formatCustomerAddress(stop, stop);

  // Determine if customer has coordinates
  const hasCustomerCoords = !!(stop.customer_latitude && stop.customer_longitude);
  const canSkipGeofence = allowOffDistanceVisits && hasCustomerCoords;
  // Can check-in: GPS ready + within fence, no coords, or explicit employee bypass.
  const canCheckIn = visitGuard.canStartVisit
    && !gpsLoading
    && (isWithinFence || !hasCustomerCoords || canSkipGeofence);

  // GPS status display
  const gpsStatusInfo = (() => {
    if (gpsLoading) return { icon: '⏳', text: 'Obteniendo ubicación...', color: colors.textDim };
    if (locStatus === 'denied') return { icon: '🚫', text: 'GPS denegado. Habilita ubicación.', color: colors.error };
    if (locStatus === 'error') return { icon: '⚠️', text: locError || 'Error GPS', color: colors.warning };
    if (!hasCustomerCoords) return { icon: '📍', text: 'Cliente sin coordenadas (check-in libre)', color: colors.warning };
    if (canSkipGeofence && !isWithinFence) {
      return {
        icon: '🟠',
        text: `A ${Math.round(distanceMeters || 0)}m del cliente · excepción por permiso`,
        color: colors.warning,
      };
    }
    if (isWithinFence) return { icon: '✅', text: `A ${Math.round(distanceMeters || 0)}m del cliente`, color: colors.success };
    return { icon: '🔴', text: `A ${Math.round(distanceMeters || 0)}m — necesitas estar a <${GEOFENCE_RADIUS_M}m`, color: colors.error };
  })();

  const forecast = stop._koldForecast;

  // ── PRE CHECK-IN STATE ──
  if (!checkedIn) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Check-in" showBack />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Text style={[typography.body, styles.customerName]}>{stop.customer_name}</Text>
          {stop.customer_ref && (
            <Text style={[typography.dimSmall, { textAlign: 'center' }]}>
              Ref: {stop.customer_ref}
            </Text>
          )}
          {/* Dirección para validar que llegó al cliente correcto ANTES de
              hacer check-in (clave para clientes sin letrero claro). */}
          <Text
            style={[
              typography.dimSmall,
              { textAlign: 'center', marginTop: 4, marginBottom: 12 },
              !address.hasAddress && styles.addressMuted,
            ]}
          >
            📍 {address.text}{address.reference ? ` · 🔖 ${address.reference}` : ''}
          </Text>

          {/* GPS Status Card */}
          <View style={[styles.geoCard, { borderColor: gpsStatusInfo.color + '40' }]}>
            {gpsLoading ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={typography.stateIcon}>{gpsStatusInfo.icon}</Text>
            )}
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[typography.bodySmall, styles.geoStatusText, { color: gpsStatusInfo.color }]}>
                {gpsStatusInfo.text}
              </Text>
              {latitude && (
                <Text style={typography.dimSmall}>
                  GPS: {latitude.toFixed(5)}, {longitude?.toFixed(5)}
                </Text>
              )}
            </View>
          </View>

          {/* Distance visualization */}
          {hasCustomerCoords && !gpsLoading && distanceMeters != null && (
            <View style={styles.distanceBar}>
              <View style={styles.distanceTrack}>
                <View style={[
                  styles.distanceFill,
                  {
                    width: `${Math.min(100, Math.max(5, (1 - distanceMeters / 200) * 100))}%`,
                    backgroundColor: isWithinFence ? colors.success : colors.error,
                  }
                ]} />
              </View>
              <Text style={[typography.dimSmall, styles.distanceLabel, { color: isWithinFence ? colors.success : colors.error }]}>
                {Math.round(distanceMeters)}m / {GEOFENCE_RADIUS_M}m
              </Text>
              {canSkipGeofence && !isWithinFence && (
                <Text style={[typography.dimSmall, styles.distanceLabel, { color: colors.warning }]}>
                  Check-in permitido por permiso del empleado
                </Text>
              )}
            </View>
          )}

          {/* Check-in actions */}
          <View style={styles.checkInActionRow}>
            <Button
              label={
                !visitGuard.canStartVisit
                  ? visitGuard.primaryActionLabel
                  : gpsLoading
                  ? 'Obteniendo GPS...'
                  : canCheckIn
                    ? canSkipGeofence && !isWithinFence
                      ? '🟠 Hacer Check-in (permiso especial)'
                      : '📍 Hacer Check-in'
                    : `🔴 Fuera de rango (${Math.round(distanceMeters || 0)}m)`
              }
              onPress={handleCheckIn}
              disabled={!canCheckIn || checkingIn}
              loading={gpsLoading}
              style={styles.checkInButton}
            />
            <Button
              label="📍 Maps"
              variant="secondary"
              onPress={handleOpenLocation}
              style={styles.checkInMapsButton}
            />
          </View>

          {/* Retry GPS button */}
          {!gpsLoading && !isWithinFence && hasCustomerCoords && (
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={async () => {
                setGpsLoading(true);
                try {
                  const pos = await getCurrentPosition();
                  if (pos) setLocation(pos.latitude, pos.longitude, pos.accuracy || 0);
                } catch { /* ignore */ }
                setGpsLoading(false);
              }}
            >
              <Text style={[typography.bodySmall, styles.retryText]}>🔄 Actualizar ubicación</Text>
            </TouchableOpacity>
          )}

          {/* Forecast hint */}
          {forecast && (
            <Card style={{ marginTop: 16 }}>
              <Text style={typography.dimSmall}>FORECAST HOY</Text>
              <Text style={[typography.screenTitle, { color: colors.primary }]}>
                {forecast.predicted_kg.toFixed(0)} kg estimados
              </Text>
            </Card>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── POST CHECK-IN STATE ──
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title="En visita"
        showBack
        rightAction={{
          label: `⏱ ${formatElapsed(elapsedSeconds)}`,
          onPress: () => {},
        }}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* GPS confirmation bar */}
        <View style={styles.geoBar}>
          <Text style={[typography.dimSmall, styles.geoBarText]}>
            📍 Check-in: {new Date(checkInTime || Date.now()).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
            {latitude ? ` · ${latitude.toFixed(4)}, ${longitude?.toFixed(4)}` : ''} ✓
          </Text>
        </View>

        <Text style={[typography.body, styles.customerName]}>{stop.customer_name}</Text>

        {flashMessage ? (
          <View style={styles.flashBar}>
            <Text style={[typography.dim, styles.flashText]}>{flashMessage}</Text>
          </View>
        ) : null}

        {/* Action grid — hasta 7 acciones: Venta, Regalo, No venta, Datos,
            Cobrar, Cambio, Consignación (+ Preventa, siempre visible). */}
        <View style={styles.actionGrid}>
          {actionVisibility.showSale ? (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionPrimary]}
              onPress={() => router.push(`/sale/${stop.id}` as never)}
            >
              <Text style={typography.stateIcon}>🧾</Text>
              <Text style={[typography.bodySmall, styles.actionLabel]}>Hacer Venta</Text>
            </TouchableOpacity>
          ) : null}

          {actionVisibility.showGift ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push(`/gift/${stop.id}?from=checkin` as never)}
            >
              <Text style={typography.stateIcon}>🎁</Text>
              <Text style={[typography.bodySmall, styles.actionLabel]}>Registrar Regalo</Text>
            </TouchableOpacity>
          ) : null}

          {actionVisibility.showNoSale ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push(`/nosale/${stop.id}` as never)}
            >
              <Text style={typography.stateIcon}>✕</Text>
              <Text style={[typography.bodySmall, styles.actionLabel]}>No Venta</Text>
            </TouchableOpacity>
          ) : null}

          {actionVisibility.showData ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push(`/postvisit/${stop.id}` as never)}
            >
              <Text style={typography.stateIcon}>📋</Text>
              <Text style={[typography.bodySmall, styles.actionLabel]}>Datos</Text>
            </TouchableOpacity>
          ) : null}

          {showCollect ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                if (stop) router.push(`/collect/${stop.customer_id}` as never);
              }}
            >
              <Text style={typography.stateIcon}>💰</Text>
              <Text style={[typography.bodySmall, styles.actionLabel]}>Cobrar</Text>
            </TouchableOpacity>
          ) : null}

          {showCollect ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push(`/exchange/${stop.id}` as never)}
            >
              <Text style={typography.stateIcon}>🔁</Text>
              <Text style={[typography.bodySmall, styles.actionLabel]}>Registrar Cambio</Text>
            </TouchableOpacity>
          ) : null}

          {showCollect ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push(`/consignment/${stop.id}` as never)}
            >
              <Text style={typography.stateIcon}>📦</Text>
              <Text style={[typography.bodySmall, styles.actionLabel]}>Consignación</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push(`/presale?stopId=${stop.id}` as never)}
          >
            <Text style={typography.stateIcon}>📅</Text>
            <Text style={[typography.bodySmall, styles.actionLabel]}>Preventa</Text>
          </TouchableOpacity>
        </View>

        <Button
          label="📍 Abrir ubicación"
          variant="secondary"
          onPress={handleOpenLocation}
          fullWidth
        />

        {isOffrouteVisit ? (
          <Button
            label="Cerrar visita especial"
            variant="danger"
            onPress={handleCloseSpecialVisit}
            fullWidth
            style={{ marginTop: 8 }}
          />
        ) : null}

        {/* Quick context card */}
        <Text style={typography.sectionTitle}>CONTEXTO RAPIDO</Text>
        <Card>
          <View style={styles.metricRow}>
            <Text style={typography.metricLabel}>Forecast hoy</Text>
            <Text style={[typography.metricValue, { color: colors.primary }]}>
              {forecast ? `${forecast.predicted_kg.toFixed(0)} kg` : 'Sin dato'}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={typography.metricLabel}>Prob. compra</Text>
            <Text style={typography.metricValue}>
              {forecast ? `${(forecast.probability_of_purchase * 100).toFixed(0)}%` : 'Sin dato'}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={typography.metricLabel}>Confianza</Text>
            <Badge
              label={forecast?.confidence_level || 'Sin dato'}
              variant={forecast?.confidence_level === 'high' ? 'green' : forecast?.confidence_level === 'medium' ? 'yellow' : 'red'}
            />
          </View>
        </Card>

        {/* Check-out button */}
        <View style={{ marginTop: 14 }}>
          <TouchableOpacity
            style={styles.checkoutBtn}
            onPress={() => router.push(`/checkout/${stop.id}` as never)}
          >
            <Text style={[typography.button, styles.checkoutText]}>✓ Check-out · Terminar Visita</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  customerName: {
    textAlign: 'center', color: colors.text, paddingVertical: 10,
  },
  addressMuted: { fontStyle: 'italic', opacity: 0.7 },
  // Geofence card (pre check-in)
  geoCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radii.button,
    borderWidth: 1, borderColor: colors.border,
    padding: 14, marginBottom: 10,
  },
  geoStatusText: { fontFamily: fonts.bodyBold, fontWeight: '700' },
  distanceBar: { marginBottom: 10 },
  distanceTrack: {
    height: 6, backgroundColor: colors.border,
    borderRadius: 3, overflow: 'hidden',
  },
  distanceFill: { height: 6, borderRadius: 3 },
  distanceLabel: { fontFamily: fonts.bodyBold, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  checkInActionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginTop: 16,
  },
  checkInButton: { flex: 1 },
  checkInMapsButton: { flexBasis: 112, paddingHorizontal: 12 },
  retryBtn: {
    alignItems: 'center', paddingVertical: 12, marginTop: 8,
  },
  retryText: { color: colors.primary, fontFamily: fonts.bodyBold, fontWeight: '700' },
  // GPS confirmation (post check-in)
  geoBar: {
    backgroundColor: colors.successAlpha08,
    borderWidth: 1, borderColor: colors.successAlpha12,
    borderRadius: radii.button, padding: 10,
    alignItems: 'center', marginBottom: 10,
  },
  geoBarText: { fontFamily: fonts.bodyBold, fontWeight: '700', color: colors.success },
  flashBar: {
    backgroundColor: colors.successAlpha08,
    borderColor: colors.successAlpha12,
    borderWidth: 1,
    borderRadius: radii.button,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    alignItems: 'center',
  },
  flashText: {
    fontFamily: fonts.bodyBold,
    fontWeight: '700',
    color: colors.success,
  },
  // Action grid
  actionGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 8, marginBottom: 16,
  },
  actionBtn: {
    width: '48%', backgroundColor: colors.cardLighter,
    borderRadius: radii.button, paddingVertical: 18,
    alignItems: 'center', gap: 4,
    flexGrow: 1, flexBasis: '46%',
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionLabel: { fontFamily: fonts.bodyBold, fontWeight: '700', color: colors.text },
  metricRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 7, borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  checkoutBtn: {
    width: '100%', paddingVertical: 16,
    borderRadius: radii.card, alignItems: 'center',
    backgroundColor: colors.success,
  },
  checkoutText: { color: colors.textOnPrimary },
});
