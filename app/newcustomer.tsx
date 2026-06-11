/**
 * Nuevo Lead — captura información de un prospecto que no está en el sistema.
 * Encola como 'prospection' para sincronizar con Odoo (crm.lead) al tener conexión.
 */

import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { colors, spacing, radii } from '../src/theme/tokens';
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

  function updateField(key: keyof NewLeadForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    if (!form.nombre.trim()) {
      Alert.alert('Falta nombre', 'El nombre del prospecto es obligatorio.');
      return;
    }

    enqueue('prospection', buildProspectionPayload(form, { latitude, longitude }));

    setSaved(true);
    Alert.alert(
      'Lead guardado',
      `"${form.nombre.trim()}" se sincronizará con el servidor. Puedes continuar la ruta.`,
      [{ text: 'OK', onPress: () => router.back() }],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TopBar title="Nuevo Lead" showBack />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>
          Registra un prospecto que no está en el sistema. Se creará como lead en Odoo al sincronizar.
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Nombre *</Text>
          <TextInput
            style={styles.input}
            placeholder="Nombre del negocio o persona"
            placeholderTextColor={colors.textDim}
            value={form.nombre}
            onChangeText={(v) => updateField('nombre', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Teléfono</Text>
          <TextInput
            style={styles.input}
            placeholder="10 dígitos"
            placeholderTextColor={colors.textDim}
            keyboardType="phone-pad"
            value={form.telefono}
            onChangeText={(v) => updateField('telefono', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Dirección</Text>
          <TextInput
            style={styles.input}
            placeholder="Calle, número, colonia"
            placeholderTextColor={colors.textDim}
            value={form.direccion}
            onChangeText={(v) => updateField('direccion', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Giro del negocio</Text>
          <View style={styles.chipWrap}>
            {GIRO_OPTIONS.map((g) => {
              const selected = form.giro === g.slug;
              return (
                <TouchableOpacity
                  key={g.slug}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => updateField('giro', selected ? '' : g.slug)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {g.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {form.giro ? (
            <Text style={styles.canalHint}>{canalHint(form.giro)}</Text>
          ) : null}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Notas adicionales</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="Horarios, referencias, observaciones..."
            placeholderTextColor={colors.textDim}
            multiline
            numberOfLines={3}
            value={form.notas}
            onChangeText={(v) => updateField('notas', v)}
          />
        </View>

        <Button
          label={saved ? '✓ Lead Guardado' : 'Guardar Lead'}
          onPress={handleSave}
          fullWidth
          disabled={saved}
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
    fontSize: 13,
    color: colors.textDim,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  fieldGroup: { marginBottom: spacing.lg },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textDim,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.card,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.card,
    borderRadius: radii.button,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryAlpha08,
  },
  chipText: {
    fontSize: 13,
    color: colors.textDim,
  },
  chipTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  canalHint: {
    marginTop: 8,
    fontSize: 12,
    color: colors.primary,
  },
});
