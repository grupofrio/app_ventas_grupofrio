import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { Input } from '../../src/components/ui/Input';
import { colors, spacing } from '../../src/theme/tokens';
import { typography } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import {
  buildCustomerContactUpdatePayload,
  CustomerContactForm,
  phoneChanged,
  validateCustomerContactForm,
} from '../../src/services/customerContactUpdate';
import { assertCurrentEmployeeDayBundleAllowsActions } from '../../src/services/dayBundleMutationGate';

export default function CustomerEditScreen() {
  const { partnerId, stopId } = useLocalSearchParams<{ partnerId: string; stopId?: string }>();
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
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
    phone: currentStop?.phone ?? '',
    mobile: currentStop?.mobile ?? '',
    email: currentStop?.email ?? '',
  });
  // Valores con los que abrió el formulario: base para no sobrescribir sin confirmar.
  const [initialContact] = useState({
    phone: currentStop?.phone ?? '',
    mobile: currentStop?.mobile ?? '',
  });
  const [saving, setSaving] = useState(false);

  function updateField(key: keyof CustomerContactForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function doSave() {
    try {
      await assertCurrentEmployeeDayBundleAllowsActions();
    } catch (error) {
      Alert.alert('Bundle vencido', error instanceof Error ? error.message : 'Renueva el bundle del día antes de editar el contacto.');
      return;
    }
    setSaving(true);

    const payload = buildCustomerContactUpdatePayload(numericPartnerId, form);
    enqueue('customer_update', payload);

    setSaving(false);
    Alert.alert(
      isOnline ? 'Cliente actualizado' : 'Cambio pendiente',
      isOnline
        ? 'Los cambios se guardaron en la app y se sincronizaran con Odoo.'
        : 'No hay conexion. Los cambios quedaron en cola para sincronizar.',
      [{ text: 'OK', onPress: () => router.back() }],
    );
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

    // No sobrescribir un teléfono existente sin confirmación explícita.
    const replacing: string[] = [];
    if (initialContact.phone.trim() && phoneChanged(initialContact.phone, form.phone)) {
      replacing.push(`el teléfono (${initialContact.phone.trim()})`);
    }
    if (initialContact.mobile.trim() && phoneChanged(initialContact.mobile, form.mobile)) {
      replacing.push(`el móvil (${initialContact.mobile.trim()})`);
    }
    if (replacing.length > 0) {
      Alert.alert(
        'Confirmar cambio',
        `Este cliente ya tiene registrado ${replacing.join(' y ')}. ¿Reemplazarlo?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Reemplazar', style: 'destructive', onPress: doSave },
        ],
      );
      return;
    }

    doSave();
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Card>
          <Text style={[typography.screenTitle, styles.headerTitle]}>{currentStop.customer_name}</Text>
          {currentStop.customer_ref ? (
            <Text style={[typography.dim, styles.headerSubtitle]}>Ref: {currentStop.customer_ref}</Text>
          ) : null}
        </Card>

        <View style={styles.fieldGroup}>
          <Input
            label="NOMBRE DEL CLIENTE *"
            placeholder="Nombre comercial"
            value={form.name}
            onChangeText={(value) => updateField('name', value)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Input
            label="TELEFONO"
            placeholder="Telefono fijo"
            value={form.phone}
            onChangeText={(value) => updateField('phone', value)}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Input
            label="MOVIL"
            placeholder="Telefono movil"
            value={form.mobile}
            onChangeText={(value) => updateField('mobile', value)}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Input
            label="EMAIL"
            placeholder="correo@ejemplo.com"
            value={form.email}
            onChangeText={(value) => updateField('email', value)}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <Button
          label="Guardar cambios"
          onPress={handleSave}
          fullWidth
          loading={saving}
          style={{ marginTop: 18 }}
        />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screenPadding },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  headerTitle: {},
  headerSubtitle: { marginTop: 6 },
  fieldGroup: { marginTop: 16 },
});
