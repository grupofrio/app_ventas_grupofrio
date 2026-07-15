/**
 * Vehicle checklist screen — Sprint A + A.1.
 *
 * Ports the PWA Colaboradores ScreenChecklistUnidad bootstrap + answer flow:
 *   ensureChecklistReady → render checks → submit each → complete.
 *
 * Supports yes_no / numeric / text / PHOTO checks (A.1). Photo capture reuses
 * the existing camera.ts (takePhoto + readPhotoAsBase64). Online-first: the
 * base64 is sent to /pwa-ruta/vehicle-check immediately (no offline queue for
 * checklist photos in this sprint).
 *
 * On completion, if the checklist has a numeric odometer check, its value is
 * auto-registered as KM inicial via /pwa-ruta/km-update (A.1, Option A) so the
 * vendor doesn't capture KM twice.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, Image, ScrollView, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
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
import { updateKm } from '../../src/services/routeKm';
import {
  chooseAuthoritativeKm,
  extractOdometerKm,
  isChecklistAnsweredForStart,
} from '../../src/services/routeStartLogic';
import { buildYesNoVehicleCheckAnswer } from '../../src/services/vehicleChecklistLogic';
import { takePhoto, readPhotoAsBase64, getCameraPermissionStatus } from '../../src/services/camera';
import { GFVehicleCheck, GFVehicleChecklist } from '../../src/types/routeStart';
import { useRouteStartStore } from '../../src/stores/useRouteStartStore';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { isCurrentRoutePlan } from '../../src/services/routeStartUi';

interface CheckDraft {
  bool?: boolean;
  numeric?: string;
  text?: string;
  reason?: string;
  photoUri?: string; // local file URI of a freshly captured photo (not yet sent)
}

function isCurrentPlan(capturedPlanId: number): boolean {
  const currentPlan = useRouteStore.getState().plan;
  const currentStartPlanId = useRouteStartStore.getState().planId;
  return isCurrentRoutePlan({
    capturedPlanId,
    currentPlanId: currentPlan?.plan_id ?? null,
    currentRouteStartPlanId: currentStartPlanId,
  });
}

function showRouteChangedAlert(): void {
  Alert.alert('La ruta cambió', 'Este checklist pertenece a otra ruta. Vuelve al plan actual.');
}

export default function ChecklistScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const planIdNum = Number(planId);
  const router = useRouter();
  const setChecklistCompleteForPlan = useRouteStartStore((s) => s.setChecklistCompleteForPlan);
  const setKmInitialForPlan = useRouteStartStore((s) => s.setKmInitialForPlan);
  const currentRoutePlanId = useRouteStore((s) => s.plan?.plan_id ?? null);
  const currentStartPlanId = useRouteStartStore((s) => s.planId);
  const stalePlan = currentRoutePlanId !== planIdNum || currentStartPlanId !== planIdNum;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [header, setHeader] = useState<GFVehicleChecklist | null>(null);
  const [checks, setChecks] = useState<GFVehicleCheck[]>([]);
  const [drafts, setDrafts] = useState<Record<number, CheckDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [capturingId, setCapturingId] = useState<number | null>(null);
  const [completing, setCompleting] = useState(false);

  const bootstrap = useCallback(async () => {
    if (!planIdNum || planIdNum <= 0) {
      setError('Plan inválido.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const capturedPlanId = planIdNum;
    if (!isCurrentPlan(capturedPlanId)) return;
    try {
      const { header: h, checks: c } = await ensureChecklistReady(capturedPlanId);
      if (h.state === 'completed') {
        setChecklistCompleteForPlan(capturedPlanId, true);
      }
      if (!isCurrentPlan(capturedPlanId)) return;
      setHeader(h);
      setChecks(c);
    } catch (err) {
      if (isCurrentPlan(capturedPlanId)) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar el checklist.');
      }
    } finally {
      if (isCurrentPlan(capturedPlanId)) {
        setLoading(false);
      }
    }
  }, [planIdNum, setChecklistCompleteForPlan]);

  React.useEffect(() => {
    if (!stalePlan) void bootstrap();
  }, [bootstrap, stalePlan]);

  async function reloadChecks() {
    const capturedPlanId = planIdNum;
    if (!isCurrentPlan(capturedPlanId)) return;
    try {
      const { header: h, checks: c } = await ensureChecklistReady(capturedPlanId);
      if (!isCurrentPlan(capturedPlanId)) return;
      setHeader(h);
      setChecks(c);
    } catch {
      // keep current view
    }
  }

  // Capture (or re-capture) a photo for a photo-type check. Reuses camera.ts.
  async function handleTakePhoto(check: GFVehicleCheck) {
    if (capturingId) return;
    setCapturingId(check.id);
    try {
      const perm = await getCameraPermissionStatus();
      // takePhoto requests permission internally, but we pre-check to give a
      // clear message when it was previously denied.
      const photo = await takePhoto();
      if (!photo) {
        const after = await getCameraPermissionStatus();
        if (perm === 'denied' || after === 'denied') {
          Alert.alert(
            'Permiso de cámara',
            'KoldField necesita permiso de cámara para la foto del checklist. Actívalo en los ajustes del teléfono.',
          );
        }
        // otherwise: user cancelled — no message needed
        return;
      }
      setDrafts((d) => ({ ...d, [check.id]: { ...d[check.id], photoUri: photo.localUri } }));
    } catch {
      Alert.alert('Error de cámara', 'No se pudo tomar la foto. Intenta de nuevo.');
    } finally {
      setCapturingId(null);
    }
  }

  async function handleAnswer(check: GFVehicleCheck) {
    if (savingId) return;
    const capturedPlanId = planIdNum;
    const draft = drafts[check.id] || {};
    let payload: Parameters<typeof submitVehicleCheck>[1];

    if (check.check_type === 'yes_no') {
      if (draft.bool == null) {
        Alert.alert('Falta respuesta', 'Selecciona Sí o No.');
        return;
      }
      payload = buildYesNoVehicleCheckAnswer({
        value: draft.bool,
        expected: check.expected_bool,
        reason: draft.reason,
      });
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
    } else if (check.check_type === 'photo') {
      if (!draft.photoUri) {
        Alert.alert('Falta foto', 'Toma la foto antes de guardar este punto.');
        return;
      }
      const base64 = await readPhotoAsBase64(draft.photoUri);
      if (!base64) {
        Alert.alert('Foto no disponible', 'No se pudo leer la foto. Tómala de nuevo.');
        return;
      }
      payload = {
        result_photo: base64, // base64 sin prefijo data: — contrato /pwa-ruta/vehicle-check
        result_photo_filename: `odometro_${check.id}_${Date.now()}.jpg`,
      };
    } else {
      Alert.alert('Tipo no soportado', `Este punto (${check.check_type}) no se puede responder en esta versión.`);
      return;
    }

    setSavingId(check.id);
    try {
      if (!isCurrentPlan(capturedPlanId)) {
        showRouteChangedAlert();
        return;
      }
      await submitVehicleCheck(check.id, payload);
      if (!isCurrentPlan(capturedPlanId)) return;
      // clear the local photo draft after a successful send
      setDrafts((d) => ({ ...d, [check.id]: { ...d[check.id], photoUri: undefined } }));
      await reloadChecks();
    } catch (err) {
      if (!isCurrentPlan(capturedPlanId)) return;
      const msg = err instanceof Error ? err.message : 'No se pudo guardar la respuesta.';
      if (/photo_too_large|too.?large|grande|tama/i.test(msg)) {
        Alert.alert('Foto muy pesada', 'La foto es demasiado grande. Toma una nueva con menos detalle o mejor luz.');
      } else if (/invalid_photo|formato/i.test(msg)) {
        Alert.alert('Formato inválido', 'La foto no tiene un formato válido. Tómala de nuevo.');
      } else if (/requires.?reason|motivo/i.test(msg)) {
        Alert.alert('Motivo requerido', 'El servidor pidió motivo para esta respuesta. Intenta de nuevo.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSavingId(null);
    }
  }

  async function handleComplete() {
    if (completing) return;
    const capturedPlanId = planIdNum;
    setCompleting(true);
    try {
      if (!isCurrentPlan(capturedPlanId)) {
        showRouteChangedAlert();
        return;
      }
      await completeVehicleChecklist(header?.id ?? 0);
      setChecklistCompleteForPlan(capturedPlanId, true);

      // A.1 Option A: feed KM inicial from the checklist odometer numeric
      // check so the vendor doesn't capture KM twice. Best-effort: a failure
      // here does NOT fail the checklist — the hub keeps a manual KM fallback.
      const odoKm = extractOdometerKm(checks);
      if (odoKm != null && capturedPlanId > 0) {
        try {
          if (!isCurrentPlan(capturedPlanId)) {
            showRouteChangedAlert();
            return;
          }
          const res = await updateKm(capturedPlanId, 'departure', odoKm);
          setKmInitialForPlan(capturedPlanId, chooseAuthoritativeKm({ backendKm: res.departure_km }));
        } catch {
          // leave KM to the hub fallback; do not block completion
        }
      }

      if (isCurrentPlan(capturedPlanId)) {
        Alert.alert('Checklist completado', 'La inspección de unidad quedó registrada.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (err) {
      if (!isCurrentPlan(capturedPlanId)) return;
      const msg = err instanceof Error ? err.message : 'No se pudo completar el checklist.';
      if (/checks_pending|pendiente/i.test(msg)) {
        Alert.alert('Faltan respuestas', 'Responde todos los puntos obligatorios antes de completar.');
      } else if (/blocking|bloqueante/i.test(msg)) {
        if (isChecklistAnsweredForStart(header)) {
          setChecklistCompleteForPlan(capturedPlanId, true);
          Alert.alert(
            'Checklist registrado',
            'Las respuestas quedaron guardadas. Hay puntos no aprobados, pero el estado del vehículo quedó actualizado.',
            [{ text: 'OK', onPress: () => router.back() }],
          );
        } else {
          Alert.alert('Faltan respuestas', 'Responde todos los puntos antes de continuar.');
        }
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setCompleting(false);
    }
  }

  if (stalePlan) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Checklist de unidad" showBack />
        <View style={styles.center}>
          <Text style={styles.errorText}>
            Este checklist pertenece a otra ruta. Vuelve al plan actual para continuar.
          </Text>
          <Button label="Volver" variant="primary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
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
                  placeholder="Motivo (opcional)"
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
                <View>
                  {/* Already-sent photo (from a previous answer) */}
                  {!draft.photoUri && check.answered && check.result_photo_url ? (
                    <View style={styles.photoSentRow}>
                      <Text style={styles.photoSentText}>✓ Foto registrada</Text>
                    </View>
                  ) : null}

                  {/* Freshly captured photo preview */}
                  {draft.photoUri ? (
                    <Image source={{ uri: draft.photoUri }} style={styles.photoPreview} resizeMode="cover" />
                  ) : null}

                  {!completed && (
                    <Button
                      label={
                        capturingId === check.id
                          ? 'Abriendo cámara…'
                          : draft.photoUri
                            ? '📷 Tomar de nuevo'
                            : (check.answered ? '📷 Reemplazar foto' : '📷 Tomar foto')
                      }
                      variant="secondary"
                      onPress={() => handleTakePhoto(check)}
                      disabled={capturingId === check.id}
                      loading={capturingId === check.id}
                      small
                    />
                  )}
                </View>
              )}

              {!completed && (
                <Button
                  label={check.answered ? 'Actualizar' : 'Guardar'}
                  variant={check.answered ? 'secondary' : 'primary'}
                  onPress={() => handleAnswer(check)}
                  disabled={savingId === check.id || (check.check_type === 'photo' && !draft.photoUri)}
                  loading={savingId === check.id}
                  small
                  style={check.check_type === 'photo' ? { marginTop: 8 } : undefined}
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
  photoPreview: {
    width: '100%', height: 180, borderRadius: radii.button, marginBottom: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  photoSentRow: { marginBottom: 8 },
  photoSentText: { fontSize: 13, color: colors.success, fontWeight: '600' },
});
