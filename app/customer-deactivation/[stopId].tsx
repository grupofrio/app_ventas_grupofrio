import React, { useState, useCallback, useRef } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { AlertBanner } from '../../src/components/ui/AlertBanner';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { typography } from '../../src/theme/typography';
import { takePhoto } from '../../src/services/camera';
import { getCurrentPosition } from '../../src/services/gps';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { useLocationStore } from '../../src/stores/useLocationStore';
import { captureCustomerDeactivationScope, assertCustomerDeactivationScope, fetchOpenCustomerDeactivation, loadCustomerDeactivationResult, persistCustomerDeactivationResult } from '../../src/services/customerDeactivation';
import { createUuidV4 } from '../../src/utils/clientEvent';
import type { CustomerDeactivationScope } from '../../src/types/customerDeactivation';
import {
  DEACTIVATION_REASONS,
  isCustomerDeactivationUnderReview,
  findQueuedCustomerDeactivation,
  buildCustomerDeactivationRequestPayload,
  buildCustomerDeactivationStopPatch,
  requiresCustomerDeactivationPhoto,
  validateCustomerDeactivationRequest,
} from '../../src/services/customerDeactivationLogic';
import type { CustomerDeactivationReason } from '../../src/types/customerDeactivation';

export default function CustomerDeactivationRequestScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const numericStopId = Number(stopId);

  const stops = useRouteStore((s) => s.stops);
  const plan = useRouteStore((s) => s.plan);
  const patchStop = useRouteStore((s) => s.patchStop);
  const stop = stops.find((candidate) => candidate.id === numericStopId);
  const enqueue = useSyncStore((s) => s.enqueue);
  const isOnline = useSyncStore((s) => s.isOnline);
  const queue = useSyncStore((s) => s.queue);
  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);
  const accuracy = useLocationStore((s) => s.accuracy);

  const [reason, setReason] = useState<CustomerDeactivationReason | null>(null);
  const [comment, setComment] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [localPhotoUri, setLocalPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [lookup, setLookup] = useState<'loading' | 'ready' | 'error'>('loading');
  const [lookupMessage, setLookupMessage] = useState('');
  const durableRetry = useRef<{id: string; scope: CustomerDeactivationScope} | null>(null);
  const partnerId = stop?._partnerId || stop?.customer_id;
  const queued = findQueuedCustomerDeactivation(queue, numericStopId, partnerId);
  const knownDone = queue.some(item => item.type === 'customer_deactivation_request' && (item.payload.stop_id === numericStopId || item.payload.partner_id === partnerId) && item.status === 'done');
  const underReview = isCustomerDeactivationUnderReview(stop?.deactivation_state);
  const applied = stop?.deactivation_state === 'applied';

  useFocusEffect(useCallback(() => {
    let active = true;
    if (!partnerId || !stop) {
      setLookup('ready');
      return () => { active = false; };
    }
    setLookup('loading');
    void (async () => {
      const scope = await captureCustomerDeactivationScope(stop.id);
      const local = await loadCustomerDeactivationResult(scope, stop.id);
      if (!active) return local;
      if (local) patchStop(stop.id, buildCustomerDeactivationStopPatch({requestId: local.request_id, state: local.state, reason: local.reason}));
      if (!isOnline) return local;
      const open = await fetchOpenCustomerDeactivation(stop.id, partnerId);
      const result = open ?? (local?.state === 'applied' || local?.state === 'rejected' ? local : null);
      if (!active) return result;
      await persistCustomerDeactivationResult(scope, stop.id, result);
      return result;
    })().then(result => {
      if (!active) return;
      if (result) {
        patchStop(stop.id, buildCustomerDeactivationStopPatch({requestId: result.request_id, state: result.state, reason: result.reason}));
      } else if (isOnline && !findQueuedCustomerDeactivation(useSyncStore.getState().queue, stop.id, partnerId)) {
        // An explicit empty server lookup clears stale review; preserve final applied state.
        const current = useRouteStore.getState().stops.find(item => item.id === stop.id);
        if (current?.deactivation_state !== 'applied') patchStop(stop.id, {deactivation_request_id: null, deactivation_state: null, deactivation_under_review: false});
      }
      setLookup('ready'); setLookupMessage('');
    }).catch(error => {
      if (!active) return;
      setLookup('error'); setLookupMessage(error instanceof Error ? error.message : 'No se pudo consultar la solicitud.');
    });
    return () => { active = false; };
  }, [numericStopId, partnerId, isOnline, patchStop]));


  if (!stop) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Posible baja" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>Parada no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  const photoRequired = requiresCustomerDeactivationPhoto(reason);
  const hasGps = typeof latitude === 'number' && typeof longitude === 'number';

  async function handleTakePhoto() {
    const photo = await takePhoto();
    if (!photo) {
      Alert.alert('Foto no capturada', 'No se pudo capturar la evidencia.');
      return;
    }
    setLocalPhotoUri(photo.localUri);
  }

  async function handleSubmit() {
    if (submittingRef.current || !stop) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const scope = await captureCustomerDeactivationScope(stop.id);
      if (!durableRetry.current && queued?.status === 'pending') durableRetry.current = {id: queued.id, scope: queued.payload._deactivationScope as CustomerDeactivationScope};
      if (durableRetry.current) {
        await assertCustomerDeactivationScope(durableRetry.current.scope, stop.id);
        await useSyncStore.getState().persistQueue();
        await assertCustomerDeactivationScope(durableRetry.current.scope, stop.id);
        useSyncStore.getState().releaseProcessingHolds([durableRetry.current.id]);
        durableRetry.current = null;
        Alert.alert('Solicitud guardada', 'Guardada en el dispositivo. Consulta el envío en Sincronización.', [{text:'OK',onPress:()=>router.back()}]);
        return;
      }
      if (findQueuedCustomerDeactivation(useSyncStore.getState().queue, stop.id, partnerId) || underReview || applied) {
        Alert.alert('Solicitud existente', 'Consulta el estado antes de crear otra solicitud.');
        return;
      }
      if (isOnline) {
        const existing = await fetchOpenCustomerDeactivation(stop.id, partnerId!);
        await assertCustomerDeactivationScope(scope, stop.id);
        if (existing && existing.state !== 'rejected') {
          patchStop(stop.id, buildCustomerDeactivationStopPatch({requestId: existing.request_id, state: existing.state, reason: existing.reason}));
          Alert.alert('Solicitud existente', 'El cliente ya tiene una solicitud registrada.');
          return;
        }
      } else if (knownDone && stop.deactivation_state !== 'rejected') {
        throw new Error('Conéctate para consultar la solicitud enviada antes de crear otra.');
      }
      let gps = hasGps
        ? { latitude: latitude as number, longitude: longitude as number, accuracy }
        : null;

      if (!gps) {
        const current = await getCurrentPosition();
        if (current) {
          gps = {
            latitude: current.latitude,
            longitude: current.longitude,
            accuracy: current.accuracy ?? null,
          };
        }
      }

      const validation = validateCustomerDeactivationRequest({
        reason,
        comment,
        localPhotoUri,
        latitude: gps?.latitude ?? null,
        longitude: gps?.longitude ?? null,
      });
      if (validation) {
        Alert.alert('Faltan datos', validation);
        return;
      }

      const payload = buildCustomerDeactivationRequestPayload({
        clientOperationId: createUuidV4(),
        stop,
        plan,
        scope,
        form: {
          reason: reason as CustomerDeactivationReason,
          comment,
          contactPerson,
          localPhotoUri,
        },
        gps: gps!,
        capturedAt: new Date().toISOString(),
      });

      await assertCustomerDeactivationScope(scope, stop.id);
      // Holding processing until durable persistence avoids sending a request that can be lost on restart.
      const id = enqueue('customer_deactivation_request', payload, {operationId: payload.operation_id, holdProcessing: true});
      durableRetry.current = {id, scope};
      await useSyncStore.getState().persistQueue();
      await assertCustomerDeactivationScope(scope, stop.id);
      patchStop(stop.id, buildCustomerDeactivationStopPatch({state: 'queued', reason: reason!}));
      useSyncStore.getState().releaseProcessingHolds([id]);
      durableRetry.current = null;
      Alert.alert('Solicitud guardada', 'Guardada en el dispositivo; pendiente de confirmación de Odoo. Consulta el envío en Sincronización.', [{text:'OK',onPress:()=>router.back()}]);
    } catch (error) {
      Alert.alert('No se pudo completar', error instanceof Error ? error.message : 'Intenta de nuevo.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Posible baja" showBack />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {!isOnline ? (
          <AlertBanner
            variant="warning"
            icon="!"
            message="Sin conexion: la solicitud quedara guardada localmente."
          />
        ) : null}

        {lookup === 'error' ? <AlertBanner variant="warning" icon="!" message={`No se pudo consultar Odoo: ${lookupMessage}`} /> : null}
        {queued || underReview || applied ? <AlertBanner variant="warning" icon="!" message={queued ? 'Solicitud local pendiente. Consulta o reintenta el envío en Sincronización.' : applied ? 'Baja aplicada en Odoo.' : 'Solicitud confirmada por Odoo y en revisión.'} /> : null}
        {stop.deactivation_state === 'rejected' ? <Text style={typography.dim}>La solicitud anterior fue rechazada.</Text> : null}
        <View style={styles.card}>
          <Text style={styles.customerName}>{stop.customer_name}</Text>
          {stop.customer_ref ? <Text style={typography.dim}>Ref: {stop.customer_ref}</Text> : null}
          <Text style={styles.note}>
            Este proceso no da de baja al cliente. Sugey valida en campo, Angelica Jaimes da visto
            bueno en su PWA y Odoo conserva la verificacion final.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Motivo</Text>
        <View style={styles.chipWrap}>
          {DEACTIVATION_REASONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.chip, reason === option.value && styles.chipOn]}
              onPress={() => setReason(option.value)}
            >
              <Text style={[styles.chipText, reason === option.value && styles.chipTextOn]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Comentario obligatorio</Text>
        <TextInput
          style={styles.textArea}
          value={comment}
          onChangeText={setComment}
          placeholder="Describe que observaste y por que solicitas revision"
          placeholderTextColor={colors.textDim}
          multiline
          maxLength={2000}
        />

        <Text style={styles.sectionTitle}>Persona consultada</Text>
        <TextInput
          style={styles.input}
          value={contactPerson}
          onChangeText={setContactPerson}
          maxLength={160}
          placeholder="Opcional"
          placeholderTextColor={colors.textDim}
        />

        <View style={styles.card}>
          <Text style={styles.sectionTitleInline}>GPS</Text>
          <Text style={typography.dim}>
            {hasGps
              ? `Listo: ${latitude?.toFixed(5)}, ${longitude?.toFixed(5)}`
              : 'Se intentara capturar al guardar.'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitleInline}>
            Evidencia fotografica{photoRequired ? ' obligatoria' : ''}
          </Text>
          <Text style={typography.dim}>
            {localPhotoUri ? 'Foto capturada' : photoRequired ? 'Requerida para este motivo' : 'Opcional para este motivo'}
          </Text>
          <Button
            label={localPhotoUri ? 'Tomar otra foto' : 'Tomar foto'}
            variant="secondary"
            onPress={handleTakePhoto}
            style={{ marginTop: 10 }}
          />
        </View>

        <Button
          label={submitting ? 'Guardando...' : durableRetry.current || queued?.status === 'pending' ? 'Reintentar guardado' : 'Guardar solicitud'}
          disabled={!durableRetry.current && queued?.status !== 'pending' && (!!queued || underReview || applied || (isOnline && lookup !== 'ready'))}
          variant="primary"
          onPress={handleSubmit}
          loading={submitting}
          fullWidth
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 110, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customerName: { ...typography.screenTitle, fontWeight: '800', color: colors.text, marginBottom: 4 },
  note: { ...typography.dim, color: colors.textDim, marginTop: 10, lineHeight: 17 },
  sectionTitle: {
    ...typography.dim,
    fontWeight: '800',
    color: colors.textDim,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  sectionTitleInline: { ...typography.bodySmall, fontWeight: '800', color: colors.text, marginBottom: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.bodySmall, fontWeight: '700', color: colors.text },
  chipTextOn: { color: '#FFFFFF' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.card,
  },
  textArea: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.card,
    textAlignVertical: 'top',
  },
});
