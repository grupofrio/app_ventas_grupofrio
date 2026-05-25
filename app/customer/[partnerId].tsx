import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import {
  buildCustomerContactStopPatch,
  buildCustomerContactUpdatePayload,
  CustomerContactForm,
  validateCustomerContactForm,
} from '../../src/services/customerContactUpdate';

export default function CustomerEditScreen() {
  const { partnerId, stopId } = useLocalSearchParams<{ partnerId: string; stopId?: string }>();
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
  const patchStop = useRouteStore((s) => s.patchStop);
  const enqueue = useSyncStore((s) => s.enqueue);
  const isOnline = useSyncStore((s) => s.isOnline);

  const numericPartnerId = Number(partnerId);
  const numericStopId = stopId ? Number(stopId) : null;
  const currentStop = useMemo(() => {
    if (numericStopId != null && Number.isFinite(numericStopId)) {
      const byStop = stops.find((stop) => stop.id === numericStopId);
      if (byStop) return byStop;
    }
    return stops.find((stop) => (
      stop.customer_id === numericPartnerId || stop._partnerId === numericPartnerId
    ));
  }, [numericPartnerId, numericStopId, stops]);

  const [form, setForm] = useState<CustomerContactForm>({
    name: currentStop?.customer_name ?? '',
    contactName: currentStop?.contact_name ?? '',
    phone: currentStop?.phone ?? '',
    mobile: currentStop?.mobile ?? '',
    email: currentStop?.email ?? '',
  });
  const [saving, setSaving] = useState(false);

  function updateField(key: keyof CustomerContactForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    if (!Number.isFinite(numericPartnerId) || numericPartnerId <= 0) {
      Alert.alert('Cliente no disponible', 'No se pudo determinar el cliente a actualizar.');
      return;
    }

    const error = validateCustomerContactForm(form);
    if (error) {
      Alert.alert('Revisa los datos', error);
      return;
    }

    if (saving) return;
    setSaving(true);

    const payload = buildCustomerContactUpdatePayload(numericPartnerId, form);
    enqueue('customer_update', payload);

    if (currentStop) {
      patchStop(currentStop.id, buildCustomerContactStopPatch(form));
    }

    setSaving(false);
    Alert.alert(
      isOnline ? 'Cliente actualizado' : 'Cambio pendiente',
      isOnline
        ? 'Los cambios se guardaron en la app y se sincronizaran con Odoo.'
        : 'No hay conexion. Los cambios quedaron en cola para sincronizar.',
      [{ text: 'OK', onPress: () => router.back() }],
    );
  }

  if (!currentStop) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Editar cliente" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>Cliente no encontrado en la ruta actual.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Editar cliente" showBack />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.headerTitle}>{currentStop.customer_name}</Text>
          {currentStop.customer_ref ? (
            <Text style={styles.headerSubtitle}>Ref: {currentStop.customer_ref}</Text>
          ) : null}
        </Card>

        <Text style={styles.inputLabel}>NOMBRE DEL CLIENTE *</Text>
        <TextInput
          style={styles.input}
          placeholder="Nombre comercial"
          placeholderTextColor={colors.textDim}
          value={form.name}
          onChangeText={(value) => updateField('name', value)}
        />

        <Text style={styles.inputLabel}>CONTACTO</Text>
        <TextInput
          style={styles.input}
          placeholder="Nombre del contacto"
          placeholderTextColor={colors.textDim}
          value={form.contactName}
          onChangeText={(value) => updateField('contactName', value)}
        />

        <Text style={styles.inputLabel}>TELEFONO</Text>
        <TextInput
          style={styles.input}
          placeholder="Telefono fijo"
          placeholderTextColor={colors.textDim}
          value={form.phone}
          onChangeText={(value) => updateField('phone', value)}
          keyboardType="phone-pad"
        />

        <Text style={styles.inputLabel}>MOVIL</Text>
        <TextInput
          style={styles.input}
          placeholder="Telefono movil"
          placeholderTextColor={colors.textDim}
          value={form.mobile}
          onChangeText={(value) => updateField('mobile', value)}
          keyboardType="phone-pad"
        />

        <Text style={styles.inputLabel}>EMAIL</Text>
        <TextInput
          style={styles.input}
          placeholder="correo@ejemplo.com"
          placeholderTextColor={colors.textDim}
          value={form.email}
          onChangeText={(value) => updateField('email', value)}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Button
          label="Guardar cambios"
          onPress={handleSave}
          fullWidth
          loading={saving}
          style={{ marginTop: 18 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screenPadding },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 12, color: colors.textDim, marginTop: 6 },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textDim,
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
  },
});
