/**
 * Stop Detail screen — s-stop / s-beto in mockup.
 * F2: Shell with correct routing, customer context, and geo-fence bar.
 * F3: Full visit flow (check-in, sale, no-sale, checkout).
 *
 * NOTE: s-stop and s-beto are the SAME route.
 * UI renders conditionally based on:
 * 1. GPS distance (geo-fence)
 * 2. KoldScore category
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { GeoFenceBar } from '../../src/components/ui/GeoFenceBar';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { AlertBanner } from '../../src/components/ui/AlertBanner';
import { ScoreCard } from '../../src/components/domain/ScoreCard';
import { ForecastCard } from '../../src/components/domain/ForecastCard';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useKoldStore } from '../../src/stores/useKoldStore';
import { useLocationStore } from '../../src/stores/useLocationStore';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useVisitStore } from '../../src/stores/useVisitStore';
import { deriveVisitGuard } from '../../src/services/visitGuards';
import { getStopTypeLabel } from '../../src/services/routePresentation';
import { describeGeoStatus } from '../../src/services/trustSignals';
import { logInfo } from '../../src/utils/logger';
import { visitTelemetryCounters } from '../../src/utils/visitTelemetry';
import { getLeadActionVisibility, getLeadPartnerId } from '../../src/services/leadVisit';
import { formatCustomerAddress } from '../../src/services/formatCustomerAddress';
import { buildStopNavigationUrls } from '../../src/services/locationNavigation';
import {
  hasContactPhone,
  MISSING_PHONE_CTA_LABEL,
  MISSING_PHONE_NOTICE,
} from '../../src/services/customerContactUpdate';

export default function StopDetailScreen() {
  const { stopId, giftSuccess } = useLocalSearchParams<{ stopId: string; giftSuccess?: string }>();
  const router = useRouter();
  const [giftSuccessMessage, setGiftSuccessMessage] = React.useState<string | null>(null);
  const stops = useRouteStore((s) => s.stops);
  const stop = stops.find((s) => s.id === Number(stopId));

  // F7: Set geo-fence target for this customer
  const setTarget = useLocationStore((s) => s.setTarget);
  const locStatus = useLocationStore((s) => s.status);
  const realDistance = useLocationStore((s) => s.distanceMeters);
  const realIsWithin = useLocationStore((s) => s.isWithinFence);
  const realAccuracy = useLocationStore((s) => s.accuracy);

  React.useEffect(() => {
    if (stop?.customer_latitude && stop?.customer_longitude) {
      setTarget(stop.customer_latitude, stop.customer_longitude);
    }
    return () => useLocationStore.getState().clearTarget();
  }, [stop?.id]);

  React.useEffect(() => {
    if (typeof giftSuccess !== 'string' || giftSuccess.trim().length === 0) return;
    setGiftSuccessMessage(giftSuccess);
    const timer = setTimeout(() => setGiftSuccessMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [giftSuccess]);

  if (!stop) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar title="Parada" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>Parada no encontrada (ID: {stopId})</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasScore = !!stop._koldScore;
  const hasForecast = !!stop._koldForecast;
  // F7: Use real GPS distance, fallback to enriched values.
  const isGeoOk = locStatus === 'ready' ? realIsWithin : (stop._geoFenceOk ?? false);
  // Trust signal: estado de geo SIN distancia ficticia. Si no hay fix de GPS ni
  // geo del cliente, se muestra "no disponible" (no "999m"). No cambia el gate
  // de visita (isGeoOk), solo lo que ve el vendedor.
  const hasClientGeo = !!(stop.customer_latitude && stop.customer_longitude);
  const geoDistance = locStatus === 'ready' ? realDistance : (stop._distanceMeters ?? null);
  const geo = describeGeoStatus({
    locStatus,
    hasClientGeo,
    distanceMeters: geoDistance,
    accuracyMeters: realAccuracy,
  });
  const scoreModuleAvailable = useKoldStore((s) => s.scoreModuleAvailable);
  const demandModuleAvailable = useKoldStore((s) => s.demandModuleAvailable);
  const allowOffDistanceVisits = useAuthStore((s) => s.allowOffDistanceVisits);
  const phase = useVisitStore((s) => s.phase);
  const currentStopId = useVisitStore((s) => s.currentStopId);
  const currentStopExists = currentStopId == null
    ? true
    : stops.some((candidate) => candidate.id === currentStopId);

  // Telemetry: record when the guard is about to ignore an "another
  // visit in progress" block because the active visit's stop no longer
  // exists in the plan. This is the "ghost suppression" case; we want
  // to see it fire on real refresh loops in piloto, not on steady-state.
  React.useEffect(() => {
    if (currentStopId != null && !currentStopExists) {
      visitTelemetryCounters.guardGhostSuppressedTotal += 1;
      logInfo('visit', 'guard_ghost_suppressed', {
        currentStopId,
        viewingStopId: stop.id,
        totalTriggers: visitTelemetryCounters.guardGhostSuppressedTotal,
      });
    }
  }, [currentStopId, currentStopExists, stop.id]);

  const canOperateOffDistance = allowOffDistanceVisits && !!(stop.customer_latitude && stop.customer_longitude);
  const visitGuard = deriveVisitGuard({
    stopState: stop.state,
    stopId: stop.id,
    currentStopId,
    phase,
    currentStopExists,
  });
  const canStartVisit = isGeoOk || canOperateOffDistance;
  const canOpenVisit = visitGuard.canResumeVisit || (visitGuard.canStartVisit && canStartVisit);
  const primaryActionLabel = visitGuard.canStartVisit && !canStartVisit
    ? (geo.distanceKnown && geo.distanceMeters != null
        ? `🔴 Fuera de rango (${Math.round(geo.distanceMeters)}m)`
        : '🔴 Ubicación no disponible')
    : visitGuard.primaryActionLabel;
  const stopTypeLabel = getStopTypeLabel(stop);
  const actionVisibility = getLeadActionVisibility(stop);
  const editablePartnerId = stop._entityType === 'lead'
    ? getLeadPartnerId(stop)
    : stop.customer_id;

  const openCustomerEditor = () => {
    if (!editablePartnerId) {
      Alert.alert('Cliente no disponible', 'Primero completa Datos para crear o enlazar el contacto.');
      return;
    }
    router.push({
      pathname: '/customer/[partnerId]',
      params: {
        partnerId: String(editablePartnerId),
        stopId: String(stop.id),
      },
    } as never);
  };
  // Aviso de captura: solo clientes (no leads) sin phone NI mobile (el campo de
  // WhatsApp normalizado lo administra el bot y queda fuera de esta lógica).
  const showMissingPhoneNotice =
    stop._entityType !== 'lead' && !!editablePartnerId && !hasContactPhone(stop);

  const address = formatCustomerAddress(stop, stop);

  function handleOpenLocation() {
    if (!stop) return;
    const { primaryUrl, fallbackUrl } = buildStopNavigationUrls(stop);
    if (!primaryUrl) {
      Alert.alert(
        'Sin ubicación',
        'Este cliente no tiene dirección ni coordenadas registradas para navegar.',
      );
      return;
    }
    Linking.openURL(primaryUrl).catch(() => {
      if (fallbackUrl) {
        Linking.openURL(fallbackUrl).catch(() => {
          Alert.alert('No se pudo abrir', 'No se pudo abrir la ubicación en Maps.');
        });
      } else {
        Alert.alert('No se pudo abrir', 'No se pudo abrir la ubicación en Maps.');
      }
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title={stop.customer_name} showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* Geo-fence indicator */}
        <GeoFenceBar tone={geo.tone} label={geo.label} />
        {giftSuccessMessage ? (
          <AlertBanner
            variant="success"
            icon="✓"
            message={giftSuccessMessage}
          />
        ) : null}

        <Card>
          <View style={styles.customerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={typography.screenTitle}>{stop.customer_name}</Text>
              {stop.customer_ref && (
                <Text style={typography.dim}>Ref: {stop.customer_ref}</Text>
              )}
              <Text
                style={[
                  typography.dim,
                  { marginTop: 4 },
                  !address.hasAddress && styles.addressMuted,
                ]}
              >
                📍 {address.text}
              </Text>
              {address.reference ? (
                <Text style={[typography.dimSmall, { marginTop: 2 }]}>
                  🔖 {address.reference}
                </Text>
              ) : null}
              <View style={styles.headerActions}>
                <Button
                  label="🗺️ Abrir en Maps"
                  variant="secondary"
                  small
                  onPress={handleOpenLocation}
                />
                <Button
                  label="Editar cliente"
                  variant="secondary"
                  small
                  onPress={openCustomerEditor}
                />
              </View>
            </View>
          </View>
          {showMissingPhoneNotice && (
            <View style={{ marginTop: 10 }}>
              <AlertBanner variant="warning" icon="📱" message={MISSING_PHONE_NOTICE} />
              <Button
                label={MISSING_PHONE_CTA_LABEL}
                small
                onPress={openCustomerEditor}
                style={{ alignSelf: 'flex-start' }}
              />
            </View>
          )}
          {stopTypeLabel && (
            <View style={{ marginTop: 2 }}>
              <Badge
                label={stopTypeLabel}
                variant={stop._entityType === 'lead' ? 'orange' : 'dim'}
              />
            </View>
          )}
        </Card>

        {/* KoldScore card — actionable intelligence */}
        {hasScore ? (
          <ScoreCard score={stop._koldScore!} />
        ) : (
          <Card>
            {!scoreModuleAvailable && (
              <Text style={styles.moduleNote}>
                KoldScore no disponible. Instala el modulo para ver inteligencia comercial.
              </Text>
            )}
          </Card>
        )}

        {/* KoldDemand forecast — real data with V1 disclaimers */}
        {hasForecast ? (
          <ForecastCard forecast={stop._koldForecast!} />
        ) : demandModuleAvailable === false ? null : (
          <Card>
            <Text style={styles.sectionLabel}>🧊 FORECAST</Text>
            <Text style={styles.moduleNote}>
              {demandModuleAvailable === null
                ? 'Verificando modulo KoldDemand...'
                : 'Sin forecast para este cliente hoy.'}
            </Text>
          </Card>
        )}

        {/* Action buttons — real navigation */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.checkinBtn, !canOpenVisit && { opacity: 0.4 }]}
            onPress={() => canOpenVisit && router.push(`/checkin/${stop.id}` as never)}
            disabled={!canOpenVisit}
            activeOpacity={0.8}
          >
            <Text style={styles.checkinText}>{primaryActionLabel}</Text>
          </TouchableOpacity>
          {canOperateOffDistance && !isGeoOk && (
            <Text style={styles.overrideHint}>
              Permiso activo: puedes operar fuera de rango para esta visita.
            </Text>
          )}
          <View style={styles.actionRow}>
            {actionVisibility.showData ? (
              <Button
                label="📋 Datos"
                variant="secondary"
                onPress={() => router.push(`/postvisit/${stop.id}` as never)}
                style={{ flex: 1 }}
                disabled={!visitGuard.canAccessVisitActions}
              />
            ) : null}
            {actionVisibility.showSale ? (
              <Button
                label="🧾 Venta"
                variant="secondary"
                onPress={() => router.push(`/sale/${stop.id}` as never)}
                style={{ flex: 1 }}
                disabled={!visitGuard.canAccessVisitActions}
              />
            ) : null}
            {actionVisibility.showGift ? (
              <Button
                label="🎁 Regalo"
                variant="secondary"
                onPress={() => router.push(`/gift/${stop.id}?from=stop` as never)}
                style={{ flex: 1 }}
                disabled={!visitGuard.canAccessVisitActions}
              />
            ) : null}
            {actionVisibility.showNoSale ? (
              <Button
                label="✕ No venta"
                variant="danger"
                onPress={() => router.push(`/nosale/${stop.id}` as never)}
                style={{ flex: 1 }}
                disabled={!visitGuard.canAccessVisitActions}
              />
            ) : null}
          </View>
          <View style={styles.actionRow}>
            <Button
              label="⭐ Lealtad"
              variant="secondary"
              onPress={() => {
                // Programa de Lealtad (lectura): nivel/racha del cliente desde
                // Odoo (gf_partner_loyalty). Requiere un partner resuelto.
                if (!editablePartnerId) {
                  Alert.alert('Lealtad', 'Este cliente aún no tiene contacto enlazado. Completa Datos primero.');
                  return;
                }
                router.push({
                  pathname: '/loyalty/[partnerId]',
                  params: { partnerId: String(editablePartnerId) },
                } as never);
              }}
              fullWidth
            />
          </View>
          {/* BLD-CONSIGNMENT: flujo real (gf_consignment). Vive dentro del
              cliente, sólo clientes de alta (no leads). Abre crear/visita/
              cierre según consignación activa. */}
          {stop._entityType !== 'lead' && (
            <View style={styles.actionRow}>
              <Button
                label="📦 Consignación"
                variant="secondary"
                onPress={() => router.push(`/consignment/${stop.id}` as never)}
                fullWidth
              />
            </View>
          )}
        </View>

        {/* KoldScore action suggestion */}
        {hasScore && stop._koldScore!.action && (
          <Card>
            <Text style={styles.sectionLabel}>ACCION SUGERIDA</Text>
            <Text style={typography.body}>{stop._koldScore!.action}</Text>
          </Card>
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  customerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  addressMuted: { fontStyle: 'italic', opacity: 0.7 },
  moduleNote: {
    fontSize: 11, color: colors.textDim, fontStyle: 'italic', marginTop: 6,
  },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, color: colors.textDim, marginBottom: 6,
  },
  forecastRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  forecastKg: {
    fontFamily: fonts.monoBold, fontSize: 22, fontWeight: '700', color: colors.text,
  },
  forecastProb: {
    fontFamily: fonts.monoBold, fontSize: 16, fontWeight: '700', color: colors.purple,
  },
  actions: { gap: 8, marginVertical: 14 },
  actionRow: { flexDirection: 'row', gap: 6 },
  checkinBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: radii.card,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  checkinText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  overrideHint: {
    fontSize: 11,
    color: '#F59E0B',
    textAlign: 'center',
    marginTop: -2,
  },
});
