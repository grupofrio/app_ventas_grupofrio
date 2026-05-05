/**
 * No-sale screen — s-nosale in mockup (lines 308-321).
 * Reason selection, competitor detection, notes, mandatory photo.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography } from '../../src/theme/typography';
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

const COMPETITORS = ['Crystal', 'Ice Factory', 'Pureza', 'Generico'];

export default function NoSaleScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
  const stop = stops.find((s) => s.id === Number(stopId));
  const updateStopState = useRouteStore((s) => s.updateStopState);
  const removeStop = useRouteStore((s) => s.removeStop);

  const {
    noSaleReasonId, noSaleCompetitor, noSaleNotes, noSalePhotoTaken,
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
  const showCompetitor = selectedReasonId === 5; // competitor reason
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
    router.replace('/(tabs)' as never);
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
        if (closePayload) {
          enqueue('offroute_visit_close', {
            ...closePayload,
            timestamp: Date.now(),
          });
        }
        finalizeNoSaleLocally();
        return;
      }

      if (closePayload) {
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

      finalizeNoSaleLocally();
      return;
    }

    const noSaleId = enqueue('no_sale', {
      stop_id: stop.id,
      partner_id: partnerId,
      reason_id: selectedReasonId,
      reason_code: reason?.code,
      competitor: selectedCompetitor,
      notes,
      timestamp: Date.now(),
    });

    const checkoutPayload = buildCheckoutPayload({
      stopId: stop.id,
      latitude: latitude || 0,
      longitude: longitude || 0,
      saleTotal: 0,
      noSaleReasonId: selectedReasonId,
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

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={styles.hint}>Alimenta KoldDemand para mejorar forecasts.</Text>

        {/* Reason selection */}
        <Text style={styles.sectionTitle}>¿Por que no se vendio?</Text>
        <View style={styles.chipContainer}>
          {NO_SALE_REASONS.map((reason) => (
            <TouchableOpacity
              key={reason.id}
              style={[
                styles.chip,
                selectedReasonId === reason.id && styles.chipSelected,
              ]}
              onPress={() => setSelectedReasonId(reason.id)}
            >
              <Text style={[
                styles.chipText,
                selectedReasonId === reason.id && styles.chipTextSelected,
              ]}>
                {reason.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Competitor detection (shown when reason = competitor) */}
        {showCompetitor && (
          <>
            <Text style={styles.inputLabel}>COMPETIDOR DETECTADO</Text>
            <View style={styles.chipContainer}>
              {COMPETITORS.map((comp) => (
                <TouchableOpacity
                  key={comp}
                  style={[
                    styles.chip,
                    selectedCompetitor === comp && styles.chipSelected,
                  ]}
                  onPress={() => {
                    setSelectedCompetitor(selectedCompetitor === comp ? null : comp);
                    setNoSaleCompetitor(selectedCompetitor === comp ? null : comp);
                  }}
                >
                  <Text style={[
                    styles.chipText,
                    selectedCompetitor === comp && styles.chipTextSelected,
                  ]}>
                    {comp}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Notes */}
        <Text style={styles.inputLabel}>NOTAS</Text>
        <TextInput
          style={styles.textArea}
          placeholder="¿Que observaste?"
          placeholderTextColor={colors.textDim}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={2}
        />

        {/* Mandatory photo */}
        <Text style={styles.sectionTitle}>📸 Foto del punto (obligatoria)</Text>
        {noSalePhotoTaken ? (
          <View style={styles.photoDone}>
            <Text style={{ fontSize: 28 }}>📸</Text>
            <Text style={{ fontSize: 12, color: colors.success, fontWeight: '600' }}>
              ✓ Foto capturada
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.photoReq}
            onPress={async () => {
              const photo = await takePhoto();
              if (photo) {
                setNoSalePhoto(photo.localUri);
              } else {
                Alert.alert('Foto requerida', 'No se pudo capturar la foto.');
              }
            }}
          >
            <Text style={{ fontSize: 32 }}>📸</Text>
            <Text style={{ fontSize: 13, color: colors.primary, fontWeight: '600' }}>
              Tomar foto de no-venta
            </Text>
            <Text style={{ fontSize: 10, color: colors.textDim }}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  hint: { fontSize: 12, color: colors.textDim, marginBottom: 14 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  inputLabel: {
    fontSize: 11, fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.4, color: colors.textDim, marginTop: 14, marginBottom: 5,
  },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    backgroundColor: colors.cardLighter,
    borderWidth: 1, borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.primaryAlpha12,
    borderColor: colors.primary,
  },
  chipText: { fontSize: 12, color: colors.text },
  chipTextSelected: { color: colors.primary },
  textArea: {
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontSize: 15,
    minHeight: 60, textAlignVertical: 'top',
  },
  photoReq: {
    backgroundColor: colors.cardLighter,
    borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(37,99,235,0.3)',
    borderRadius: radii.card, padding: 28, alignItems: 'center', gap: 6,
  },
  photoDone: {
    backgroundColor: colors.cardLighter,
    borderWidth: 2, borderColor: colors.success,
    borderRadius: radii.card, padding: 14, alignItems: 'center', gap: 4,
  },
});
