/**
 * No-sale screen — s-nosale in mockup (lines 308-321).
 * Reason selection, competitor detection, notes, mandatory photo.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Chip } from '../../src/components/ui/Chip';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useVisitStore } from '../../src/stores/useVisitStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { takePhoto } from '../../src/services/camera';
import { useLocationStore } from '../../src/stores/useLocationStore';
import { buildCheckoutPayload } from '../../src/services/checkoutResult';
import { checkOut, closeOffrouteVisit, reportIncident } from '../../src/services/gfLogistics';
import { setGpsMode, captureAndEnqueueGpsPoint } from '../../src/services/gps';
import { isRetryableSyncErrorMessage } from '../../src/utils/syncFailure';
import { getLeadPartnerId } from '../../src/services/leadVisit';
import { NO_SALE_REASONS } from '../../src/services/noSaleReasons';
import { enqueueVisitPhotos } from '../../src/services/visitPhotos';
import { useNavigationStore } from '../../src/stores/useNavigationStore';

const COMPETITORS = ['Crystal', 'Ice Factory', 'Pureza', 'Generico'];

export default function NoSaleScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
  const stop = stops.find((s) => s.id === Number(stopId));
  const updateStopState = useRouteStore((s) => s.updateStopState);
  const removeStop = useRouteStore((s) => s.removeStop);

  const {
    noSaleReasonId, noSaleCompetitor, noSaleNotes, noSalePhotoTaken, noSalePhotoUris,
    setNoSaleReason, setNoSaleCompetitor, setNoSaleNotes, setNoSalePhoto,
    setPhase, resetVisit, offrouteVisitId,
  } = useVisitStore();

  const enqueue = useSyncStore((s) => s.enqueue);
  const isOnline = useSyncStore((s) => s.isOnline);
  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);
  const [selectedReasonId, setSelectedReasonId] = useState<number | null>(noSaleReasonId);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(noSaleCompetitor);
  const [notes, setNotes] = useState(noSaleNotes);

  if (!stop) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar title="No Venta" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>Parada no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  // BLD-20260424-STAB: derived data movido a DESPUÉS del guard de stop
  // para que TypeScript narrowee `stop` a GFStop (no GFStop|undefined).
  // Antes del refactor de Sebastián el cálculo estaba aquí; el guard se
  // intercaló más abajo y rompió tanto el tipo como la seguridad runtime.
  const partnerId = getLeadPartnerId(stop) ?? stop.customer_id;
  const COMPETITOR_REASON_ID = 5;
  const showCompetitor = selectedReasonId === COMPETITOR_REASON_ID;
  const canSave = selectedReasonId != null && noSalePhotoTaken;
  const isOffrouteVisit = !!stop._isOffroute;

  function finalizeNoSaleLocally() {
    captureAndEnqueueGpsPoint('checkout').catch(() => {});
    setGpsMode('in_transit');
    if (stop!._isOffroute) {
      removeStop(stop!.id);
    } else {
      updateStopState(stop!.id, 'done');
    }
    setPhase('checked_out');
    resetVisit();

    const currentIdx = stops.findIndex((s) => s.id === stop!.id);
    const nextStop = stops.find((s, i) => i > currentIdx && s.state === 'pending');
    if (nextStop && nextStop.customer_latitude && nextStop.customer_longitude) {
      const origin = latitude && longitude ? { latitude, longitude } : null;
      const destination = { latitude: nextStop.customer_latitude, longitude: nextStop.customer_longitude };
      useNavigationStore.getState().startNavigation(nextStop.id, origin, destination);
      router.replace('/(tabs)/route?view=map' as never);
      return;
    }
    router.replace('/(tabs)/route' as never);
  }

  async function handleAddNoSalePhoto() {
    const photo = await takePhoto();
    if (photo) {
      setNoSalePhoto(photo.localUri);
    } else {
      Alert.alert('Foto requerida', 'No se pudo capturar la foto.');
    }
  }

  async function handleSave() {
    if (!canSave) {
      const missing = [];
      if (!selectedReasonId) missing.push('razon de no-venta');
      if (!noSalePhotoTaken) missing.push('foto del punto');
      Alert.alert('Faltan datos', `Completa: ${missing.join(', ')}`);
      return;
    }

    if (!stop) return;
    const reason = NO_SALE_REASONS.find((r) => r.id === selectedReasonId);
    setNoSaleReason(selectedReasonId!, reason?.label || '');
    setNoSaleNotes(notes);

    if (isOffrouteVisit) {
      const closePayload = offrouteVisitId
        ? {
            visit_id: offrouteVisitId,
            result_status: 'no_sale' as const,
            latitude: latitude || 0,
            longitude: longitude || 0,
            notes: `No venta: ${reason?.code || ''} ${notes || ''}`.trim(),
          }
        : null;

      if (!isOnline) {
        let closeSyncId: string | null = null;
        if (closePayload) {
          closeSyncId = enqueue('offroute_visit_close', {
            ...closePayload,
            timestamp: Date.now(),
          });
        }
        enqueueVisitPhotos({
          stopId: stop.id,
          photoUris: noSalePhotoUris,
          enqueue,
          dependsOn: closeSyncId ? [closeSyncId] : undefined,
        });
        finalizeNoSaleLocally();
        return;
      }

      let closeSyncId: string | null = null;
      if (closePayload) {
        try {
          await closeOffrouteVisit(closePayload);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No se pudo cerrar la visita especial.';
          if (isRetryableSyncErrorMessage(message)) {
            closeSyncId = enqueue('offroute_visit_close', {
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

      enqueueVisitPhotos({
        stopId: stop.id,
        photoUris: noSalePhotoUris,
        enqueue,
        dependsOn: closeSyncId ? [closeSyncId] : undefined,
      });
      finalizeNoSaleLocally();
      return;
    }

    // El motivo estructurado viaja EN EL CHECKOUT: es el único camino que el
    // backend persiste en gf.route.stop (no_sale_*). El endpoint de incidentes
    // ignora estas claves (solo postea al chatter de leads).
    const checkoutPayload = buildCheckoutPayload({
      stopId: stop.id,
      latitude: latitude || 0,
      longitude: longitude || 0,
      saleTotal: 0,
      noSaleReasonId: selectedReasonId,
      noSaleReasonCode: reason?.code,
      noSaleNotes: notes,
      noSaleCompetitor: selectedReasonId === COMPETITOR_REASON_ID ? selectedCompetitor : null,
    });

    const enqueueNoSaleAndCheckout = () => {
      const noSaleId = enqueue('no_sale', {
        stop_id: stop.id,
        partner_id: partnerId,
        reason_id: selectedReasonId,
        reason_code: reason?.code,
        competitor: selectedCompetitor,
        notes,
        timestamp: Date.now(),
      });

      enqueue(
        'checkout',
        {
          ...checkoutPayload,
          timestamp: Date.now(),
        },
        { dependsOn: [noSaleId] },
      );
      enqueueVisitPhotos({
        stopId: stop.id,
        photoUris: noSalePhotoUris,
        enqueue,
        dependsOn: [noSaleId],
      });
    };

    if (!isOnline) {
      enqueueNoSaleAndCheckout();
      finalizeNoSaleLocally();
      return;
    }

    try {
      await reportIncident(
        stop.id,
        (selectedReasonId as number) || 1,
        `No-venta: ${reason?.code || ''} ${notes || ''}`.trim(),
      );
      enqueueVisitPhotos({
        stopId: stop.id,
        photoUris: noSalePhotoUris,
        enqueue,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar la no-venta.';
      if (isRetryableSyncErrorMessage(message)) {
        enqueueNoSaleAndCheckout();
        Alert.alert(
          'Sincronizacion pendiente',
          'No se pudo confirmar la no-venta con el servidor. La visita quedo pendiente de sincronizacion.',
        );
        finalizeNoSaleLocally();
        return;
      }

      Alert.alert('No-venta rechazada', message);
      return;
    }

    try {
      await checkOut(
        checkoutPayload.stop_id,
        checkoutPayload.latitude,
        checkoutPayload.longitude,
        checkoutPayload.result_status,
        {
          no_sale_reason_code: checkoutPayload.no_sale_reason_code,
          no_sale_notes: checkoutPayload.no_sale_notes,
          no_sale_competitor: checkoutPayload.no_sale_competitor,
        },
      );
      finalizeNoSaleLocally();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo completar el check-out.';
      if (isRetryableSyncErrorMessage(message)) {
        enqueue(
          'checkout',
          {
            ...checkoutPayload,
            timestamp: Date.now(),
          },
        );
        Alert.alert(
          'Check-out pendiente',
          'La no-venta ya quedo registrada, pero el cierre de visita quedo pendiente de sincronizacion.',
        );
        finalizeNoSaleLocally();
        return;
      }

      Alert.alert('Check-out rechazado', message);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="No Venta" showBack />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={[typography.dim, styles.hint]}>Alimenta KoldDemand para mejorar forecasts.</Text>

        {/* Reason selection */}
        <Text style={typography.sectionTitle}>¿Por que no se vendio?</Text>
        <View style={styles.chipContainer}>
          {NO_SALE_REASONS.map((reason) => (
            <Chip
              key={reason.id}
              label={reason.label}
              selected={selectedReasonId === reason.id}
              onPress={() => setSelectedReasonId(reason.id)}
            />
          ))}
        </View>

        {/* Competitor detection (shown when reason = competitor) */}
        {showCompetitor && (
          <>
            <Text style={typography.inputLabel}>COMPETIDOR DETECTADO</Text>
            <View style={styles.chipContainer}>
              {COMPETITORS.map((comp) => (
                <Chip
                  key={comp}
                  label={comp}
                  selected={selectedCompetitor === comp}
                  onPress={() => {
                    setSelectedCompetitor(selectedCompetitor === comp ? null : comp);
                    setNoSaleCompetitor(selectedCompetitor === comp ? null : comp);
                  }}
                />
              ))}
            </View>
          </>
        )}

        {/* Notes */}
        <Text style={typography.inputLabel}>NOTAS</Text>
        <TextInput
          style={[typography.body, styles.textArea]}
          placeholder="¿Que observaste?"
          placeholderTextColor={colors.textDim}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={2}
        />

        {/* Mandatory photo */}
        <Text style={typography.sectionTitle}>📸 Foto del punto (obligatoria)</Text>
        {noSalePhotoTaken ? (
          <View style={styles.photoDone}>
            <Text style={typography.stateIcon}>📸</Text>
            <Text style={[typography.dim, { color: colors.success, fontFamily: fonts.bodyBold, fontWeight: '700' }]}>
              {noSalePhotoUris.length} {noSalePhotoUris.length === 1 ? 'foto capturada' : 'fotos capturadas'}
            </Text>
            <TouchableOpacity style={styles.addPhotoBtn} onPress={handleAddNoSalePhoto}>
              <Text style={[typography.buttonSmall, styles.addPhotoText]}>Agregar otra foto</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.photoReq}
            onPress={handleAddNoSalePhoto}
          >
            <Text style={typography.stateIcon}>📸</Text>
            <Text style={[typography.bodySmall, { color: colors.primary, fontFamily: fonts.bodyBold, fontWeight: '700' }]}>
              Tomar foto de no-venta
            </Text>
            <Text style={typography.dimSmall}>
              Evidencia del punto de venta
            </Text>
          </TouchableOpacity>
        )}

        {/* Save button */}
        <Button
          label="Guardar No Venta"
          onPress={handleSave}
          fullWidth
          disabled={!canSave}
          style={{ marginTop: 14 }}
        />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  hint: { color: colors.textDim, marginBottom: 14 },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  textArea: {
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14, paddingVertical: 12,
    minHeight: 60, textAlignVertical: 'top',
  },
  photoReq: {
    backgroundColor: colors.cardLighter,
    borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(0,119,187,0.3)',
    borderRadius: radii.card, padding: 28, alignItems: 'center', gap: 6,
  },
  photoDone: {
    backgroundColor: colors.cardLighter,
    borderWidth: 2, borderColor: colors.success,
    borderRadius: radii.card, padding: 14, alignItems: 'center', gap: 4,
  },
  addPhotoBtn: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.button,
    backgroundColor: colors.primaryAlpha12,
  },
  addPhotoText: {
    color: colors.primary,
  },
});
