/**
 * Nuevo prospecto — tienda que no está en la ruta ni en el directorio.
 * El vendedor deja o arrastra el pin, guarda nombre y teléfono, y esa
 * misma acción abre la visita de hoy. No queda un lead suelto.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { Input } from '../src/components/ui/Input';
import { Chip } from '../src/components/ui/Chip';
import { ProspectPinMap } from '../src/components/domain/ProspectPinMap';
import { colors, spacing } from '../src/theme/tokens';
import { typography } from '../src/theme/typography';
import { useSyncStore } from '../src/stores/useSyncStore';
import { useLocationStore } from '../src/stores/useLocationStore';
import { useRouteStore } from '../src/stores/useRouteStore';
import { useVisitStore } from '../src/stores/useVisitStore';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useEmployeeDayBundleStore } from '../src/stores/useEmployeeDayBundleStore';
import { getCurrentPosition } from '../src/services/gps';
import { createFieldLeadData, startOffrouteVisit } from '../src/services/gfLogistics';
import { extractOffrouteVisitId } from '../src/services/offrouteVisit';
import { isRetryableSyncErrorMessage } from '../src/utils/syncFailure';
import {
  buildProspectionPayload,
  canalHint,
  GIRO_OPTIONS,
  NewLeadForm,
} from '../src/services/leadIntake';
import {
  isUsableCoordinate,
  prepareTodayProspectVisit,
  readCreatedLeadId,
  type SellerPin,
} from '../src/services/sellerProspectVisit';

const DEFAULT_FIELD_COMPANY_ID = 34;

export default function NewCustomerScreen() {
  const router = useRouter();
  const enqueue = useSyncStore((s) => s.enqueue);
  const isOnline = useSyncStore((s) => s.isOnline);
  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);
  const addVirtualStop = useRouteStore((s) => s.addVirtualStop);
  const updateStopState = useRouteStore((s) => s.updateStopState);
  const companyId = useAuthStore((s) => s.companyId);
  const dayBundleAccess = useEmployeeDayBundleStore((s) => s.access);
  const hydrateDayBundle = useEmployeeDayBundleStore((s) => s.hydrate);

  const [form, setForm] = useState<NewLeadForm>({
    nombre: '',
    telefono: '',
    direccion: '',
    giro: '',
    notas: '',
  });
  const [pin, setPin] = useState<SellerPin | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const pinMoved = useRef(false);

  useEffect(() => {
    void getCurrentPosition();
    void hydrateDayBundle();
  }, [hydrateDayBundle]);

  useEffect(() => {
    if (pin || pinMoved.current) return;
    if (!isUsableCoordinate(latitude, longitude)) return;
    setPin({ latitude: latitude as number, longitude: longitude as number });
  }, [latitude, longitude, pin]);

  function updateField(key: keyof NewLeadForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function placePin(next: SellerPin) {
    pinMoved.current = true;
    setPin(next);
  }

  function recenterOnMe() {
    if (!isUsableCoordinate(latitude, longitude)) {
      Alert.alert('Sin ubicación', 'Activa el GPS para centrar el mapa en donde estás.');
      return;
    }
    const next = { latitude: latitude as number, longitude: longitude as number };
    pinMoved.current = true;
    setPin(next);
    setFocusToken((value) => value + 1);
  }

  async function handleSave() {
    if (saving) return;
    if (dayBundleAccess && !dayBundleAccess.canRunActions) {
      Alert.alert(
        'Datos del día vencidos',
        'Actualiza los datos del día antes de registrar un prospecto.',
      );
      return;
    }

    const localCustomerId = Date.now();
    const prepared = prepareTodayProspectVisit({
      form,
      pin,
      localCustomerId,
    });
    if (!prepared.ok) {
      Alert.alert(prepared.title, prepared.message);
      return;
    }

    setSaving(true);
    let queueId: string | null = null;
    let confirmedOnServer = false;
    let visitOpened = false;

    try {
      const placedPin = pin;
      if (!placedPin) return;
      queueId = enqueue('prospection', buildProspectionPayload(form, {
        latitude: placedPin.latitude,
        longitude: placedPin.longitude,
      }), { holdProcessing: true });
      let leadId: number | null = null;
      let pendingLeadOperationId: string | null = queueId;

      if (isOnline) {
        const queued = useSyncStore.getState().queue.find((item) => item.id === queueId);
        try {
          const lead = await createFieldLeadData(
            queued?.payload ?? { ...prepared.visit.payload, _operationId: queueId },
          );
          leadId = readCreatedLeadId(lead);
          if (leadId) {
            useSyncStore.getState().markDone(queueId);
            pendingLeadOperationId = null;
            confirmedOnServer = true;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No se pudo registrar el prospecto.';
          if (!isRetryableSyncErrorMessage(message)) {
            useSyncStore.getState().markError(queueId, message);
          }
        }
      }

      let offrouteVisitId: number | null = null;
      if (isOnline && leadId && pin) {
        try {
          const visit = await startOffrouteVisit({
            partner_id: null,
            lead_id: leadId,
            company_id: companyId ?? DEFAULT_FIELD_COMPANY_ID,
            latitude: pin.latitude,
            longitude: pin.longitude,
          });
          offrouteVisitId = extractOffrouteVisitId(
            visit && typeof visit.id === 'number' ? visit.id : null,
          );
        } catch {
          offrouteVisitId = null;
        }
      }

      const opened = prepareTodayProspectVisit({
        form,
        pin,
        localCustomerId,
        leadId,
        pendingLeadOperationId,
        offrouteVisitId,
      });
      if (!opened.ok) {
        Alert.alert(opened.title, opened.message);
        return;
      }

      const virtualStopId = addVirtualStop(
        opened.visit.virtualStop.customerId,
        opened.visit.virtualStop.customerName,
        {
          entityType: 'lead',
          leadId: opened.visit.virtualStop.leadId,
          partnerId: null,
          offrouteVisitId,
          customerLatitude: opened.visit.virtualStop.customerLatitude,
          customerLongitude: opened.visit.virtualStop.customerLongitude,
          street: opened.visit.virtualStop.street,
          phone: opened.visit.virtualStop.phone,
          mobile: opened.visit.virtualStop.mobile,
          pendingLeadOperationId: opened.visit.virtualStop.pendingLeadOperationId,
        },
      );
      updateStopState(virtualStopId, 'in_progress');
      const created = useRouteStore.getState().stops.find((stop) => stop.id === virtualStopId);
      if (created) {
        const visitStore = useVisitStore.getState();
        visitStore.resetVisit();
        visitStore.startVisit(created, pin?.latitude ?? 0, pin?.longitude ?? 0);
        visitStore.setOffrouteVisitId(offrouteVisitId);
      }

      // The visit already exists. Opening it here matters: the alert can be
      // dismissed without onPress, and Guardar would otherwise create a second
      // prospect and abandon this visit.
      const openVisit = () => router.replace(`/checkin/${virtualStopId}` as never);
      openVisit();
      visitOpened = true;
      if (!confirmedOnServer) {
        Alert.alert(
          'Prospecto guardado. Pendiente de sincronizar.',
          `"${form.nombre.trim()}" se sincronizará con Odoo cuando haya conexión. La visita de hoy ya está abierta.`,
          [{ text: 'Abrir visita', onPress: openVisit }],
        );
      } else {
        Alert.alert(
          'Prospecto registrado',
          `"${form.nombre.trim()}" ya es una visita de hoy. Puedes convertir y vender en esta misma visita.`,
          [{ text: 'Abrir visita', onPress: openVisit }],
        );
      }
    } finally {
      if (queueId) {
        useSyncStore.getState().releaseProcessingHolds([queueId]);
        if (!confirmedOnServer && isOnline) {
          void useSyncStore.getState().processQueue();
        }
      }
      if (!visitOpened) setSaving(false);
    }
  }

  const center = isUsableCoordinate(latitude, longitude)
    ? { latitude: latitude as number, longitude: longitude as number }
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TopBar title="Nuevo prospecto" showBack />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={[typography.bodySmall, styles.subtitle]}>
          Tienda nueva, fuera del plan. Deja el pin en tu ubicación o arrástralo a la puerta. Al guardar se crea el prospecto y la visita de hoy.
        </Text>

        <ProspectPinMap
          center={center}
          pin={pin}
          focusToken={focusToken}
          onPinMoved={placePin}
        />
        <Text style={[typography.dim, styles.pinHint]}>
          {pin
            ? `Pin: ${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`
            : 'El pin aparece cuando hay ubicación. No se guarda solo.'}
        </Text>
        <Button
          label="Centrar en mi ubicación"
          variant="secondary"
          onPress={recenterOnMe}
          fullWidth
          style={{ marginBottom: spacing.lg }}
        />

        <View style={styles.fieldGroup}>
          <Input
            label="NOMBRE *"
            placeholder="Nombre del negocio o persona"
            value={form.nombre}
            onChangeText={(v) => updateField('nombre', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Input
            label="TELÉFONO *"
            placeholder="10 dígitos"
            keyboardType="phone-pad"
            value={form.telefono}
            onChangeText={(v) => updateField('telefono', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Input
            label="DIRECCIÓN"
            placeholder="Calle, número, colonia"
            value={form.direccion}
            onChangeText={(v) => updateField('direccion', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={typography.inputLabel}>Giro del negocio</Text>
          <View style={styles.chipWrap}>
            {GIRO_OPTIONS.map((g) => {
              const selected = form.giro === g.slug;
              return (
                <Chip
                  key={g.slug}
                  label={g.label}
                  selected={selected}
                  onPress={() => updateField('giro', selected ? '' : g.slug)}
                />
              );
            })}
          </View>
          {form.giro ? (
            <Text style={[typography.dim, styles.canalHint]}>{canalHint(form.giro)}</Text>
          ) : null}
        </View>

        <View style={styles.fieldGroup}>
          <Input
            label="NOTAS ADICIONALES"
            placeholder="Horarios, referencias, observaciones..."
            multiline
            numberOfLines={3}
            style={styles.inputMultiline}
            value={form.notas}
            onChangeText={(v) => updateField('notas', v)}
          />
        </View>

        <Button
          label={saving ? 'Guardando…' : 'Guardar y abrir visita'}
          onPress={() => { void handleSave(); }}
          fullWidth
          disabled={saving}
          loading={saving}
          style={{ marginTop: 8 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.lg },
  subtitle: {
    color: colors.textDim,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  pinHint: { marginTop: 8, marginBottom: 8 },
  fieldGroup: { marginBottom: spacing.lg },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  canalHint: {
    marginTop: 8,
    color: colors.primary,
  },
});
