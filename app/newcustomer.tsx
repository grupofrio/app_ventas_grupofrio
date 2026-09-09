/**
 * Nuevo Lead — captura información de un prospecto que no está en el sistema.
 * Encola como 'prospection' para sincronizar con Odoo (crm.lead) al tener conexión.
 */

import React, { useState, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { Input } from '../src/components/ui/Input';
import { Chip } from '../src/components/ui/Chip';
import { colors, spacing } from '../src/theme/tokens';
import { typography } from '../src/theme/typography';
import { useSyncStore } from '../src/stores/useSyncStore';
import { useLocationStore } from '../src/stores/useLocationStore';
import {
  buildProspectionPayload,
  canalHint,
  GIRO_OPTIONS,
  NewLeadForm,
} from '../src/services/leadIntake';

export default function NewCustomerScreen() {
  const router = useRouter();
  const enqueue = useSyncStore((s) => s.enqueue);
  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);

  const [form, setForm] = useState<NewLeadForm>({
    nombre: '',
    telefono: '',
    direccion: '',
    giro: '',
    notas: '',
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [queueId, setQueueId] = useState<string | null>(null);
  const queuedIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  usePreventRemove(saving || (queueId !== null && !saved), () => {
    Alert.alert('Guardado sin confirmar', 'Reintenta guardar este prospecto antes de salir para no perder la solicitud.');
  });
  const status = useSyncStore((s) => s.queue.find((item) => item.id === queueId)?.status);
  const isOnline = useSyncStore((s) => s.isOnline);

  function updateField(key: keyof NewLeadForm, value: string) {
    if (queuedIdRef.current) return;
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (savingRef.current || saved) return;
    if (!form.nombre.trim()) {
      Alert.alert('Falta nombre', 'El nombre del prospecto es obligatorio.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (!queuedIdRef.current) {
        queuedIdRef.current = enqueue('prospection', buildProspectionPayload(form, { latitude, longitude }), { holdProcessing: true });
      }
      const id = queuedIdRef.current;
      setQueueId(id);
      await useSyncStore.getState().persistQueue();
      setSaved(true);
      useSyncStore.getState().releaseProcessingHolds([id]);
      void useSyncStore.getState().processQueue();
    } catch {
      Alert.alert('No se pudo guardar', 'No se confirmó el guardado en el dispositivo. Reintenta antes de salir; se conservará la misma solicitud.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TopBar title="Nuevo Prospecto" showBack />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={[typography.bodySmall, styles.subtitle]}>
          Registra un prospecto que no está en el sistema. Se creará como prospecto en Odoo al sincronizar.
        </Text>

        <View style={styles.fieldGroup}>
          <Input
            label="NOMBRE *"
            placeholder="Nombre del negocio o persona"
            editable={!saving && !saved && !queuedIdRef.current}
            value={form.nombre}
            onChangeText={(v) => updateField('nombre', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Input
            label="TELÉFONO"
            placeholder="10 dígitos"
            keyboardType="phone-pad"
            editable={!saving && !saved && !queuedIdRef.current}
            value={form.telefono}
            onChangeText={(v) => updateField('telefono', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Input
            label="DIRECCIÓN"
            placeholder="Calle, número, colonia"
            editable={!saving && !saved && !queuedIdRef.current}
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
            editable={!saving && !saved && !queuedIdRef.current}
            value={form.notas}
            onChangeText={(v) => updateField('notas', v)}
          />
        </View>

        <Button
          label={saved ? '✓ Prospecto Guardado' : 'Guardar Prospecto'}
          onPress={handleSave}
          fullWidth
          disabled={saved || saving}
          style={{ marginTop: 8 }}
        />
        {saved ? (
          <View accessibilityLiveRegion="polite" style={{ marginTop: spacing.lg }}>
            <Text style={typography.bodySmall}>
              {status === 'done'
                ? 'Prospecto registrado en Odoo. Ya puedes buscarlo por nombre en Visita especial.'
                : status === 'error' || status === 'dead'
                  ? 'Prospecto guardado en el dispositivo. El envío no se confirmó; revisa Sincronización.'
                  : isOnline
                    ? 'Prospecto guardado en el dispositivo. Esperando confirmación de Odoo.'
                    : 'Prospecto guardado en el dispositivo. Se enviará al recuperar conexión.'}
            </Text>
            <Button label="Continuar ruta" onPress={() => router.back()} fullWidth style={{ marginTop: spacing.md }} />
          </View>
        ) : null}
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
