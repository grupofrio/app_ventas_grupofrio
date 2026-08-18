/**
 * No-sale screen — structured reason + conditional fields + durable operation_id.
 * Catalog authority: day_bundle (Odoo gf.no.sale.reason). Canonical write: checkout.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
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
import { checkOut, closeOffrouteVisit } from '../../src/services/gfLogistics';
import { setGpsMode, captureAndEnqueueGpsPoint } from '../../src/services/gps';
import { isRetryableSyncErrorMessage } from '../../src/utils/syncFailure';
import { useEmployeeDayBundleStore } from '../../src/stores/useEmployeeDayBundleStore';
import { enqueueVisitPhotos } from '../../src/services/visitPhotos';
import { useNavigationStore } from '../../src/stores/useNavigationStore';
import {
  persistOpenNoSaleIntent,
  retireNoSaleIntent,
  markNoSaleIntentReviewRequired,
  loadNoSaleIntent,
  type NoSaleIntentKeyParts,
} from '../../src/services/noSaleOperationPersistence';
import {
  noSaleValidationMessage,
  validateNoSaleCapture,
} from '../../src/services/noSaleValidation';
import { createSaleConfirmationSingleFlight } from '../../src/services/saleConfirmationFlow';

export default function NoSaleScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
  const plan = useRouteStore((s) => s.plan);
  const stop = stops.find((s) => s.id === Number(stopId));
  const updateStopState = useRouteStore((s) => s.updateStopState);
  const removeStop = useRouteStore((s) => s.removeStop);

  const {
    noSaleReasonId, noSaleCompetitor, noSaleNotes, noSalePhotoTaken, noSalePhotoUris,
    setNoSaleReason, setNoSaleCompetitor, setNoSaleNotes, setNoSalePhoto,
    setPhase, resetVisit, offrouteVisitId,
  } = useVisitStore();

  const enqueue = useSyncStore((s) => s.enqueue);
  const persistQueue = useSyncStore((s) => s.persistQueue);
  const isOnline = useSyncStore((s) => s.isOnline);
  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);
  const [selectedReasonId, setSelectedReasonId] = useState<number | null>(noSaleReasonId);
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(noSaleCompetitor);
  const [typedCompetitor, setTypedCompetitor] = useState('');
  const [notes, setNotes] = useState(noSaleNotes);
  const [submitting, setSubmitting] = useState(false);
  const [rehydratedOpId, setRehydratedOpId] = useState<string | null>(null);
  const [reviewRequired, setReviewRequired] = useState(false);
  const noSaleReasons = useEmployeeDayBundleStore((s) => s.noSaleReasons);
  const competitors = useEmployeeDayBundleStore((s) => s.competitors);
  const dayBundleAccess = useEmployeeDayBundleStore((s) => s.access);
  const dayBundleRecord = useEmployeeDayBundleStore((s) => s.record);
  const hydrateDayBundle = useEmployeeDayBundleStore((s) => s.hydrate);

  const singleFlightRef = useRef(createSaleConfirmationSingleFlight());

  const operationalDate = dayBundleRecord?.bundle.operational_date ?? null;
  const intentParts: NoSaleIntentKeyParts | null = stop
    ? { operationalDate, planId: plan?.plan_id ?? null, stopId: stop.id }
    : null;

  useEffect(() => {
    void hydrateDayBundle();
  }, [hydrateDayBundle]);

  useEffect(() => {
    if (!intentParts) return;
    let cancelled = false;
    void (async () => {
      const existing = await loadNoSaleIntent(intentParts);
      if (cancelled || !existing) return;
      if (existing.state === 'review_required') {
        setRehydratedOpId(existing.operation_id);
        setReviewRequired(true);
        return;
      }
      if (existing.state !== 'open') return;
      setRehydratedOpId(existing.operation_id);
      if (existing.reason_code) {
        const match = noSaleReasons.find((r) => r.code === existing.reason_code);
        if (match) setSelectedReasonId(match.id);
      }
      if (existing.notes) setNotes(existing.notes);
      if (existing.competitor) {
        if (competitors.includes(existing.competitor)) {
          setSelectedCompetitor(existing.competitor);
        } else {
          setTypedCompetitor(existing.competitor);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [intentParts?.stopId, intentParts?.planId, intentParts?.operationalDate, noSaleReasons, competitors]);

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

  const selectedReason = noSaleReasons.find((reason) => reason.id === selectedReasonId) ?? null;
  const reasonCode = selectedReason?.code ?? null;
  const showCompetitor = reasonCode === 'competitor';
  const showOtherNotes = reasonCode === 'other';
  const showSupervisorNotes = reasonCode === 'supervisor_requested';
  const competitorCatalogAvailable = competitors.length > 0;
  const effectiveCompetitor = showCompetitor
    ? (selectedCompetitor || typedCompetitor.trim() || null)
    : null;

  const validationIssue = validateNoSaleCapture({
    reasonCode,
    notes,
    competitor: effectiveCompetitor,
    photoTaken: noSalePhotoTaken,
    competitorCatalogAvailable,
  });
  const canSave = validationIssue === null && dayBundleAccess?.canRunActions === true && !reviewRequired;
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

  async function preserveForReview(message: string) {
    if (!intentParts) return;
    await markNoSaleIntentReviewRequired(intentParts);
    setReviewRequired(true);
    Alert.alert('Revisión requerida', message);
  }

  async function handleSave() {
    if (!singleFlightRef.current.tryAcquire()) return;
    if (!dayBundleAccess?.canRunActions) {
      singleFlightRef.current.release();
      Alert.alert('Bundle vencido', 'La no-venta está bloqueada hasta renovar el bundle del día con conexión.');
      return;
    }
    if (validationIssue) {
      singleFlightRef.current.release();
      Alert.alert('Faltan datos', noSaleValidationMessage(validationIssue));
      return;
    }
    if (!stop || !selectedReason || !intentParts) {
      singleFlightRef.current.release();
      return;
    }

    setNoSaleReason(selectedReason.id, selectedReason.label);
    setNoSaleNotes(notes);
    if (effectiveCompetitor) setNoSaleCompetitor(effectiveCompetitor);
    setSubmitting(true);

    try {
      // Durable operation identity BEFORE any mutating network/queue write.
      const intent = await persistOpenNoSaleIntent({
        stopId: stop.id,
        planId: plan?.plan_id ?? null,
        operationalDate,
        reasonCode: selectedReason.code,
        reasonId: selectedReason.id,
        notes,
        competitor: effectiveCompetitor,
        photoUris: noSalePhotoUris,
        latitude,
        longitude,
        operationId: rehydratedOpId ?? undefined,
      });
      const operationId = intent.operation_id;
      setRehydratedOpId(operationId);
      const capturedLatitude = intent.capture_latitude ?? latitude ?? 0;
      const capturedLongitude = intent.capture_longitude ?? longitude ?? 0;
      const capturedReasonCode = intent.reason_code;
      const capturedReasonId = intent.reason_id ?? selectedReason.id;
      const capturedNotes = intent.notes;
      const capturedCompetitor = intent.competitor;
      const capturedPhotoUris = intent.photo_uris;

      if (isOffrouteVisit) {
        if (!offrouteVisitId) {
          await preserveForReview(
            'No pudimos validar el cierre de la visita especial. La no-venta quedó pendiente de conciliación.',
          );
          return;
        }
        const closePayload = {
          visit_id: offrouteVisitId,
          result_status: 'no_sale' as const,
          latitude: capturedLatitude,
          longitude: capturedLongitude,
          notes: `No venta: ${capturedReasonCode || ''} ${capturedNotes || ''}`.trim(),
        };

        if (!isOnline) {
          let closeSyncId: string | null = null;
          closeSyncId = enqueue('offroute_visit_close', {
            ...closePayload,
            operation_id: operationId,
            timestamp: Date.now(),
          }, { operationId });
          enqueueVisitPhotos({
            stopId: stop.id,
            photoUris: capturedPhotoUris,
            enqueue,
            dependsOn: [closeSyncId],
          });
          await persistQueue();
          await retireNoSaleIntent(intentParts, 'completed');
          finalizeNoSaleLocally();
          return;
        }

        let closeSyncId: string | null = null;
        try {
          await closeOffrouteVisit({ ...closePayload, operation_id: operationId });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No se pudo cerrar la visita especial.';
          if (isRetryableSyncErrorMessage(message)) {
            closeSyncId = enqueue('offroute_visit_close', {
              ...closePayload,
              operation_id: operationId,
              timestamp: Date.now(),
            }, { operationId });
          } else {
            await preserveForReview(
              'El servidor rechazó el cierre de la visita especial. Conservamos la no-venta para conciliación; no se cerró localmente.',
            );
            return;
          }
        }

        enqueueVisitPhotos({
          stopId: stop.id,
          photoUris: capturedPhotoUris,
          enqueue,
          dependsOn: closeSyncId ? [closeSyncId] : undefined,
        });
        await persistQueue();
        await retireNoSaleIntent(intentParts, 'completed');
        finalizeNoSaleLocally();
        return;
      }

      // Canonical structured No Venta write = checkout (reason/notes/competitor on gf.route.stop).
      // Incident chatter is supplementary only and is not invoked on this path.
      const checkoutPayload = buildCheckoutPayload({
        stopId: stop.id,
        latitude: capturedLatitude,
        longitude: capturedLongitude,
        saleTotal: 0,
        noSaleReasonId: capturedReasonId,
        noSaleReasonCode: capturedReasonCode,
        noSaleNotes: capturedNotes,
        noSaleCompetitor: capturedCompetitor,
      });

      const enqueueCheckoutAndPhotos = () => {
        const checkoutId = enqueue(
          'checkout',
          {
            ...checkoutPayload,
            operation_id: operationId,
            timestamp: Date.now(),
          },
          { operationId },
        );
        enqueueVisitPhotos({
          stopId: stop.id,
          photoUris: capturedPhotoUris,
          enqueue,
          dependsOn: [checkoutId],
        });
      };

      if (!isOnline) {
        enqueueCheckoutAndPhotos();
        await persistQueue();
        await retireNoSaleIntent(intentParts, 'completed');
        finalizeNoSaleLocally();
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
          undefined,
          operationId,
        );
        enqueueVisitPhotos({
          stopId: stop.id,
          photoUris: capturedPhotoUris,
          enqueue,
        });
        await persistQueue();
        await retireNoSaleIntent(intentParts, 'completed');
        finalizeNoSaleLocally();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo completar el check-out.';
        if (isRetryableSyncErrorMessage(message)) {
          enqueueCheckoutAndPhotos();
          Alert.alert(
            'Sincronización pendiente',
            'No se pudo confirmar la no-venta con el servidor. La visita quedó pendiente de sincronización.',
          );
          await persistQueue();
          await retireNoSaleIntent(intentParts, 'completed');
          finalizeNoSaleLocally();
          return;
        }

        Alert.alert('Check-out rechazado', message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la no-venta.';
      Alert.alert('No-venta', message);
    } finally {
      setSubmitting(false);
      singleFlightRef.current.release();
    }
  }

  const notesLabel = showOtherNotes
    ? 'Especifica la causa'
    : showSupervisorNotes
      ? '¿Qué necesita revisar con el supervisor?'
      : 'NOTAS';
  const notesPlaceholder = showOtherNotes
    ? 'Describe el motivo'
    : showSupervisorNotes
      ? 'Detalle para el supervisor'
      : '¿Qué observaste? (opcional)';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="No Venta" showBack />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={[typography.dim, styles.hint]}>Alimenta KoldDemand para mejorar forecasts.</Text>

        {reviewRequired ? (
          <View style={styles.reviewRequiredCard}>
            <Text style={typography.body}>Esta no-venta requiere revisión antes de cerrar la visita.</Text>
            <Text style={typography.dim}>Conservamos la evidencia y el mismo operation_id para conciliación.</Text>
          </View>
        ) : null}

        <Text style={typography.sectionTitle}>¿Por qué no se vendió?</Text>
        <View style={styles.chipContainer}>
          {noSaleReasons.map((reason) => (
            <Chip
              key={reason.id}
              label={reason.label}
              selected={selectedReasonId === reason.id}
              onPress={() => setSelectedReasonId(reason.id)}
            />
          ))}
        </View>

        {showCompetitor && (
          <>
            <Text style={typography.inputLabel}>COMPETIDOR DETECTADO</Text>
            {competitorCatalogAvailable ? (
              <View style={styles.chipContainer}>
                {competitors.map((comp) => (
                  <Chip
                    key={comp}
                    label={comp}
                    selected={selectedCompetitor === comp}
                    onPress={() => {
                      const next = selectedCompetitor === comp ? null : comp;
                      setSelectedCompetitor(next);
                      setNoSaleCompetitor(next);
                      if (next) setTypedCompetitor('');
                    }}
                  />
                ))}
              </View>
            ) : (
              <>
                <Text style={[typography.dim, { marginBottom: 6 }]}>
                  Catálogo de competidores no disponible. Especifica el competidor:
                </Text>
                <TextInput
                  style={[typography.body, styles.textArea, { minHeight: 44 }]}
                  placeholder="Otro competidor"
                  placeholderTextColor={colors.textDim}
                  value={typedCompetitor}
                  onChangeText={setTypedCompetitor}
                />
              </>
            )}
          </>
        )}

        <Text style={typography.inputLabel}>{notesLabel}</Text>
        <TextInput
          style={[typography.body, styles.textArea]}
          placeholder={notesPlaceholder}
          placeholderTextColor={colors.textDim}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={2}
        />

        <Text style={typography.sectionTitle}>Foto del punto (obligatoria)</Text>
        {noSalePhotoTaken ? (
          <View style={styles.photoDone}>
            <Text style={[typography.dim, { color: colors.success, fontFamily: fonts.bodyBold, fontWeight: '700' }]}>
              {noSalePhotoUris.length} {noSalePhotoUris.length === 1 ? 'foto capturada' : 'fotos capturadas'}
            </Text>
            <TouchableOpacity style={styles.addPhotoBtn} onPress={handleAddNoSalePhoto}>
              <Text style={[typography.buttonSmall, styles.addPhotoText]}>Agregar otra foto</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.photoReq} onPress={handleAddNoSalePhoto}>
            <Text style={[typography.bodySmall, { color: colors.primary, fontFamily: fonts.bodyBold, fontWeight: '700' }]}>
              Tomar foto de no-venta
            </Text>
            <Text style={typography.dimSmall}>Evidencia del punto de venta</Text>
          </TouchableOpacity>
        )}

        <Button
          label={submitting ? 'Guardando…' : 'Guardar No Venta'}
          onPress={handleSave}
          fullWidth
          disabled={!canSave || submitting}
          loading={submitting}
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
  reviewRequiredCard: {
    backgroundColor: colors.warningAlpha12,
    borderRadius: radii.card,
    padding: 14,
    gap: 4,
    marginBottom: 16,
  },
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
