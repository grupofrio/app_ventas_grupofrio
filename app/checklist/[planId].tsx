/**
 * Vehicle checklist screen — Sprint A.
 *
 * Ports the PWA Colaboradores ScreenChecklistUnidad bootstrap + answer flow:
 *   ensureChecklistReady → render checks → submit each → complete.
 *
 * Sprint A supports yes_no / numeric / text checks. `photo` checks are shown
 * read-only with a notice (camera-in-checklist needs a dev client; deferred
 * to Sprint B). Most unit checks are yes_no, so this covers the daily flow.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { fonts } from '../../src/theme/typography';
import {
  ensureChecklistReady,
  submitVehicleCheck,
  completeVehicleChecklist,
} from '../../src/services/vehicleChecklist';
import { GFVehicleCheck, GFVehicleChecklist } from '../../src/types/routeStart';
import { useRouteStartStore } from '../../src/stores/useRouteStartStore';

export default function ChecklistScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const planIdNum = Number(planId);
  const router = useRouter();
  const setChecklistComplete = useRouteStartStore((s) => s.setChecklistComplete);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [header, setHeader] = useState<GFVehicleChecklist | null>(null);
  const [checks, setChecks] = useState<GFVehicleCheck[]>([]);
  const [drafts, setDrafts] = useState<Record<number, { bool?: boolean; numeric?: string; text?: string; reason?: string }>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [completing, setCompleting] = useState(false);

  const bootstrap = useCallback(async () => {
    if (!planIdNum || planIdNum <= 0) {
      setError('Plan inválido.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { header: h, checks: c } = await ensureChecklistReady(planIdNum);
      setHeader(h);
      setChecks(c);
      if (h.state === 'completed') setChecklistComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el checklist.');
    } finally {
      setLoading(false);
    }
  }, [planIdNum, setChecklistComplete]);

  React.useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  async function reloadChecks() {
    try {
      const { header: h, checks: c } = await ensureChecklistReady(planIdNum);
      setHeader(h);
      setChecks(c);
    } catch {
      // keep current view
    }
  }

  async function handleAnswer(check: GFVehicleCheck) {
    if (savingId) return;
    const draft = drafts[check.id] || {};
    let payload: Parameters<typeof submitVehicleCheck>[1];

    if (check.check_type === 'yes_no') {
      if (draft.bool == null) {
        Alert.alert('Falta respuesta', 'Selecciona Sí o No.');
        return;
      }
      // backend computes passed; if it will be a fail, require reason
      const willFail = check.expected_bool != null && draft.bool !== check.expected_bool;
      if (willFail && !(draft.reason || '').trim()) {
        Alert.alert('Motivo requerido', 'Indica el motivo cuando la respuesta no cumple.');
        return;
      }
      payload = willFail
        ? { result_bool: draft.bool, not_passed_reason: (draft.reason || '').trim() }
        : { result_bool: draft.bool };
    } else if (check.check_type === 'numeric') {
      const n = parseFloat(draft.numeric ?? '');
      if (!Number.isFinite(n)) {
        Alert.alert('Valor inválido', 'Captura un número.');
        return;
      }
      payload = { result_numeric: n };
    } else if (check.check_type === 'text') {
      const t = (draft.text || '').trim();
      if (!t) {
        Alert.alert('Falta texto', 'Escribe una respuesta.');
        return;
      }
      payload = { result_text: t };
    } else {
      Alert.alert('No soportado en esta versión', 'Los checks con foto se capturarán en una próxima versión.');
      return;
    }

    setSavingId(check.id);
    try {
      await submitVehicleCheck(check.id, payload);
      await reloadChecks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar la respuesta.';
      if (/requires.?reason|motivo/i.test(msg)) {
        setDrafts((d) => ({ ...d, [check.id]: { ...d[check.id] } }));
        Alert.alert('Motivo requerido', 'Esta respuesta requiere un motivo.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSavingId(null);
    }
  }

  async function handleComplete() {
    if (completing) return;
    setCompleting(true);
    try {
      await completeVehicleChecklist(header?.id ?? 0);
      setChecklistComplete(true);
      Alert.alert('Checklist completado', 'La inspección de unidad quedó registrada.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo completar el checklist.';
      if (/checks_pending|pendiente/i.test(msg)) {
        Alert.alert('Faltan respuestas', 'Responde todos los puntos obligatorios antes de completar.');
      } else if (/blocking|bloqueante/i.test(msg)) {
        Alert.alert('Punto crítico no aprobado', 'Hay un punto obligatorio que no pasó. No puedes completar hasta resolverlo.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setCompleting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Checklist de unidad" showBack />
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Checklist de unidad" showBack />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Button label="Reintentar" variant="primary" onPress={() => void bootstrap()} />
        </View>
      </SafeAreaView>
    );
  }

  const answered = checks.filter((c) => c.answered).length;
  const completed = header?.state === 'completed';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Checklist de unidad" showBack />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>{answered}/{checks.length} respondidos</Text>
          {completed && <Badge label="✓ Completado" variant="green" />}
        </View>

        {/* BLD-SPRINT-A: aviso honesto si hay checks foto OBLIGATORIOS sin
            responder. La captura de foto en checklist no está en Sprint A,
            así que estos puntos bloquearían "Completar". Lo hacemos visible
            para que el chofer/soporte sepan el motivo y no quede atrapado. */}
        {checks.some((c) => c.check_type === 'photo' && c.required && !c.answered) && !completed && (
          <View style={styles.photoBlockBanner}>
            <Text style={styles.photoBlockTitle}>⚠️ Puntos con foto pendientes</Text>
            <Text style={styles.photoBlockBody}>
              Este checklist incluye punto(s) obligatorios con foto que aún no se
              capturan desde la app. No podrás completar hasta resolverlos.
              Repórtalo a tu supervisor.
            </Text>
          </View>
        )}

        {checks.map((check) => {
          const draft = drafts[check.id] || {};
          const willFail = check.check_type === 'yes_no'
            && check.expected_bool != null
            && draft.bool != null
            && draft.bool !== check.expected_bool;
          return (
            <Card key={check.id}>
              <View style={styles.checkHeader}>
                <Text style={styles.checkName}>
                  {check.sequence}. {check.name}
                  {check.required ? <Text style={styles.req}> *</Text> : null}
                </Text>
                {check.answered && (
                  <Badge label={check.passed ? '✓' : '✗'} variant={check.passed ? 'green' : 'orange'} />
                )}
              </View>

              {check.check_type === 'yes_no' && (
                <View style={styles.yesNoRow}>
                  <TouchableOpacity
                    style={[styles.choice, draft.bool === true && styles.choiceOn]}
                    onPress={() => setDrafts((d) => ({ ...d, [check.id]: { ...d[check.id], bool: true } }))}
                  >
                    <Text style={[styles.choiceText, draft.bool === true && styles.choiceTextOn]}>Sí</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.choice, draft.bool === false && styles.choiceOn]}
                    onPress={() => setDrafts((d) => ({ ...d, [check.id]: { ...d[check.id], bool: false } }))}
                  >
                    <Text style={[styles.choiceText, draft.bool === false && styles.choiceTextOn]}>No</Text>
                  </TouchableOpacity>
                </View>
              )}

              {willFail && (
                <TextInput
                  style={styles.reasonInput}
                  value={draft.reason || ''}
                  onChangeText={(t) => setDrafts((d) => ({ ...d, [check.id]: { ...d[check.id], reason: t } }))}
                  placeholder="Motivo (requerido)"
                  placeholderTextColor={colors.textDim}
                  multiline
                />
              )}

              {check.check_type === 'numeric' && (
                <TextInput
                  style={styles.input}
                  value={draft.numeric ?? ''}
                  onChangeText={(t) => setDrafts((d) => ({ ...d, [check.id]: { ...d[check.id], numeric: t } }))}
                  placeholder={check.min_value != null || check.max_value != null
                    ? `Rango ${check.min_value ?? '–'} a ${check.max_value ?? '–'}`
                    : 'Valor'}
                  placeholderTextColor={colors.textDim}
                  keyboardType="numeric"
                />
              )}

              {check.check_type === 'text' && (
                <TextInput
                  style={styles.input}
                  value={draft.text ?? ''}
                  onChangeText={(t) => setDrafts((d) => ({ ...d, [check.id]: { ...d[check.id], text: t } }))}
                  placeholder="Respuesta"
                  placeholderTextColor={colors.textDim}
                  multiline
                />
              )}

              {check.check_type === 'photo' && (
                <Text style={styles.photoNotice}>
                  📷 Este punto requiere foto. Disponible en próxima versión — repórtalo a tu supervisor si es obligatorio hoy.
                </Text>
              )}

              {check.check_type !== 'photo' && !completed && (
                <Button
                  label={check.answered ? 'Actualizar' : 'Guardar'}
                  variant={check.answered ? 'secondary' : 'primary'}
                  onPress={() => handleAnswer(check)}
                  disabled={savingId === check.id}
                  loading={savingId === check.id}
                  small
                />
              )}
            </Card>
          );
        })}

        {!completed && (
          <Button
            label={completing ? 'Completando…' : 'Completar checklist'}
            variant="success"
            onPress={handleComplete}
            fullWidth
            disabled={completing}
            loading={completing}
            style={{ marginTop: 8 }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100, gap: 10 },
  errorText: { fontSize: 13, color: '#EF4444', textAlign: 'center' },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  progressText: { fontSize: 13, fontWeight: '700', color: colors.text, fontFamily: fonts.monoBold },
  checkHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  checkName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text, marginRight: 8 },
  req: { color: '#EF4444' },
  yesNoRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  choice: {
    flex: 1, height: 48, borderRadius: radii.button, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
  },
  choiceOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { fontSize: 15, fontWeight: '700', color: colors.text },
  choiceTextOn: { color: '#FFFFFF' },
  input: {
    minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.button,
    paddingHorizontal: 14, paddingVertical: 10, color: colors.text, fontSize: 15, backgroundColor: colors.card,
    marginBottom: 8,
  },
  reasonInput: {
    minHeight: 44, borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)', borderRadius: radii.button,
    paddingHorizontal: 14, paddingVertical: 8, color: colors.text, fontSize: 13, backgroundColor: colors.card,
    marginBottom: 8,
  },
  photoNotice: { fontSize: 12, color: colors.textDim, fontStyle: 'italic', marginVertical: 6 },
  photoBlockBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: 'rgba(234,179,8,0.08)', borderWidth: 1, borderColor: 'rgba(234,179,8,0.45)',
    marginBottom: 4,
  },
  photoBlockTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4 },
  photoBlockBody: { fontSize: 12, lineHeight: 17, color: colors.textDim },
});
