/**
 * Nuevo Lead — captura información de un prospecto que no está en el sistema.
 * Encola como 'prospection' para sincronizar con Odoo (crm.lead) al tener conexión.
 */

import React, { useState, useRef, useEffect } from 'react';
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
import { createNativeFieldLeadIntake, captureLeadGps } from '../src/services/fieldLeadIntakeNative';
import { getApiErrorCode } from '../src/services/apiRequestError';
import { validateLeadGps, type FieldLeadDraft, type LeadGps } from '../src/services/fieldLeadIntakeFlow';
import {
  canalHint,
  giroToCanal,
  GIRO_OPTIONS,
  NewLeadForm,
} from '../src/services/leadIntake';

export default function NewCustomerScreen() {
  const router = useRouter();
  const nativeRef = useRef<Awaited<ReturnType<typeof createNativeFieldLeadIntake>> | null>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const prompted = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [draft, setDraft] = useState<FieldLeadDraft | null>(null);
  const [gps, setGps] = useState<LeadGps | null>(null);
  const [editing, setEditing] = useState(false);
  const [verified, setVerified] = useState(false);
  const [form, setForm] = useState<NewLeadForm>({nombre:'',telefono:'',direccion:'',giro:'',notas:''});
  const saved = !!draft && draft.phase !== 'captured';
  const queueId = draft?.operationId;
  const status = useSyncStore(s => s.queue.find(item => item.id === queueId)?.status);
  const isOnline = useSyncStore(s => s.isOnline);
  const registered = status === 'done' || verified || draft?.phase === 'selling' || draft?.phase === 'ready';
  const locked = loading || saving || !!draft?.edit || (!!draft && !editing);
  usePreventRemove(saving || draft?.phase === 'captured', () => {
    Alert.alert('Guardado sin confirmar', 'Reintenta guardar el prospecto antes de salir.');
  });
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const native = await createNativeFieldLeadIntake();
        const restored = await native.flow.restore();
        if (!mounted.current) return;
        nativeRef.current = native;
        setDraft(restored);
        if (restored) { setForm(restored.edit?.form ?? restored.form); setGps(restored.edit ? restored.edit.gps : restored.gps); setEditing(!!restored.edit); }
      } catch (error) { if (mounted.current) setLoadError(error instanceof Error ? error.message : 'No se pudo recuperar el alta.'); }
      finally { if (mounted.current) setLoading(false); }
    })();
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!queueId || !saved || !isOnline || status !== undefined || !nativeRef.current) return;
    let cancelled = false;
    void nativeRef.current.confirmRegistered(queueId).then(value => { if (!cancelled) setVerified(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [queueId, saved, isOnline, status]);
  useEffect(() => {
    if (editing || !draft || !registered || draft.phase !== 'queued' || prompted.current === draft.operationId) return;
    prompted.current = draft.operationId;
    Alert.alert('Prospecto registrado', '¿Quieres registrar una venta ahora?', [
      {text:'Por ahora no', onPress:() => { void decline(); }},
      {text:'Registrar venta', onPress:() => { void startSale(); }},
    ]);
  }, [draft?.operationId, draft?.phase, registered, editing]);

  useEffect(() => {
    if (saving || !destination) return;
    if (destination === 'back') router.back();
    else router.replace(destination as never);
  }, [saving, destination, router]);

  function updateField(key: keyof NewLeadForm, value: string) {
    if (locked) return;
    setForm(previous => ({...previous,[key]:value}));
  }
  async function locate() {
    if (locked || locating) return;
    setLocating(true);
    try { const point = await captureLeadGps(); if (mounted.current) setGps(point); }
    catch (error) { if (mounted.current) Alert.alert('Ubicación sin confirmar', error instanceof Error ? error.message : 'No se pudo obtener GPS.'); }
    finally { if (mounted.current) setLocating(false); }
  }
  async function handleSave() {
    if (busyRef.current || !nativeRef.current || (saved && !editing)) return;
    if (!form.nombre.trim()) { Alert.alert('Falta nombre', 'El nombre del prospecto es obligatorio.'); return; }
    if (!giroToCanal(form.giro)) { Alert.alert('Falta giro', 'Selecciona un giro con canal comercial definido antes de guardar.'); return; }
    busyRef.current = true; setSaving(true);
    try {
      if (gps && !draft?.edit && (!draft || gps.timestamp !== draft.gps?.timestamp)) validateLeadGps(gps);
      const next = editing
        ? await nativeRef.current.flow.update(form, gps)
        : await nativeRef.current.flow.capture(form, gps);
      if (mounted.current) { setDraft({...next}); setForm(next.form); setGps(next.gps); setEditing(false); }
    } catch (error) {
      if (mounted.current) {
        setDraft(nativeRef.current.flow.getDraft());
        Alert.alert('No se pudo guardar', error instanceof Error ? error.message : 'Reintenta guardar este mismo prospecto.');
      }
    } finally { busyRef.current = false; if (mounted.current) setSaving(false); }
  }
  async function decline() {
    if (busyRef.current || !nativeRef.current) return;
    busyRef.current = true; setSaving(true);
    try { await nativeRef.current.flow.decline(); if (mounted.current) setDestination('back'); }
    catch (error) { if (mounted.current) Alert.alert('Alta pendiente', error instanceof Error ? error.message : 'Reintenta.'); }
    finally { busyRef.current = false; if (mounted.current) setSaving(false); }
  }
  async function startSale() {
    if (busyRef.current || !nativeRef.current || !draft || !registered || editing) return;
    if (!isOnline) { Alert.alert('Sin conexión', 'El prospecto está guardado. Para preparar la venta necesitas conexión.'); return; }
    busyRef.current = true; setSaving(true);
    try {
      const response = await nativeRef.current.flow.sell();
      const id = await nativeRef.current.openSale(response, draft.saleOperationId);
      if (mounted.current) setDestination(`/sale/${id}`);
    } catch (error) {
      if (mounted.current) {
        setDraft(nativeRef.current.flow.getDraft());
        if (getApiErrorCode(error) === 'lead_data_incomplete') { prompted.current = null; setEditing(true); }
        Alert.alert('Venta sin abrir', error instanceof Error ? error.message : 'Reintenta para confirmar el estado de la visita.');
      }
    } finally { busyRef.current = false; if (mounted.current) setSaving(false); }
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
            editable={!locked}
            value={form.nombre}
            onChangeText={(v) => updateField('nombre', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Input
            label="TELÉFONO (NECESARIO PARA VENDER)"
            placeholder="10 dígitos"
            keyboardType="phone-pad"
            editable={!locked}
            value={form.telefono}
            onChangeText={(v) => updateField('telefono', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Input
            label="DIRECCIÓN"
            placeholder="Calle, número, colonia"
            editable={!locked}
            value={form.direccion}
            onChangeText={(v) => updateField('direccion', v)}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={typography.inputLabel}>UBICACIÓN DEL CLIENTE</Text>
          <Text style={typography.bodySmall}>Usa tu GPS solo si estás en el negocio. La dirección escrita no genera coordenadas automáticamente.</Text>
          <Button label="Estoy en el negocio: usar mi ubicación" onPress={() => { void locate(); }} loading={locating} disabled={locked} variant="secondary" fullWidth style={{marginTop:spacing.sm}} />
          <Text accessibilityLiveRegion="polite" style={typography.bodySmall}>
            {gps ? `Ubicación capturada: precisión ${Math.round(gps.accuracy)} m.` : 'Sin coordenadas confirmadas. Puedes guardar el prospecto; para convertir y vender se requiere ubicación.'}
          </Text>
          {gps && !locked ? <Button label="Guardar solo dirección, sin GPS" variant="secondary" onPress={() => setGps(null)} small /> : null}
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
            editable={!locked}
            value={form.notas}
            onChangeText={(v) => updateField('notas', v)}
          />
        </View>

        <Button
          label={editing ? 'Guardar corrección' : saved ? '✓ Prospecto Guardado' : 'Guardar Prospecto'}
          onPress={() => { void handleSave(); }}
          loading={saving || loading}
          fullWidth
          disabled={loading || saving || (saved && !editing) || locating || !!loadError}
          style={{ marginTop: 8 }}
        />
        {loadError ? <Text style={typography.bodySmall}>{loadError}</Text> : null}
        {saved ? (
          <View accessibilityLiveRegion="polite" style={{marginTop:spacing.lg}}>
            <Text style={typography.bodySmall}>
              {registered ? 'Prospecto registrado en Odoo.'
                : status === 'error' || status === 'dead' ? 'Prospecto guardado en el dispositivo. Revisa el envío en Sincronización.'
                : isOnline ? 'Esperando confirmación de Odoo.' : 'Se enviará al recuperar conexión.'}
            </Text>
            <Button label={draft.phase === 'selling' || draft.phase === 'ready' ? 'Reanudar preparación de venta' : 'Registrar venta'}
              onPress={() => { void startSale(); }} disabled={!registered || saving || !isOnline || editing} fullWidth style={{marginTop:spacing.md}} />
            {draft.phase === 'queued' && !editing ? <Button label="Completar o corregir datos" variant="secondary" onPress={() => setEditing(true)} disabled={saving || !isOnline || !registered} fullWidth style={{marginTop:spacing.md}} /> : null}
            {draft.phase === 'queued' && !draft.edit ? <Button label="Solo guardar prospecto" variant="secondary" onPress={() => { void decline(); }} disabled={saving} fullWidth style={{marginTop:spacing.md}} /> : null}
            <Button label="Continuar ruta" variant="secondary" onPress={() => router.back()} disabled={saving} fullWidth style={{marginTop:spacing.md}} />
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
