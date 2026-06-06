/**
 * Route Start hub — Sprint A.
 *
 * Orchestrates the morning sequence for the jefe de ruta BEFORE leaving the
 * CEDIS, so they no longer need the PWA Colaboradores for this:
 *   1. Ver unidad/ruta asignada
 *   2. Checklist de unidad      → app/checklist/[planId]
 *   3. KM inicial               → inline
 *   4. Ver/aceptar carga        → app/acceptload/[planId]
 *   5. Listo para iniciar ruta  (botón preparado, wiring real fuera de Sprint A)
 *
 * Online-first (CEDIS WiFi). Each step degrades gracefully: no plan, no load,
 * offline — none of them crash the screen.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { Badge } from '../src/components/ui/Badge';
import { colors, spacing, radii } from '../src/theme/tokens';
import { typography, fonts } from '../src/theme/typography';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useRouteStore } from '../src/stores/useRouteStore';
import { useProductStore } from '../src/stores/useProductStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import { useRouteStartStore } from '../src/stores/useRouteStartStore';
import { getVehicleChecklist } from '../src/services/vehicleChecklist';
import { updateKm } from '../src/services/routeKm';
import { acceptRouteLoad } from '../src/services/gfLogistics';
import { buildRouteLoadAcceptanceState } from '../src/services/routeLoadAcceptance';
import { isChecklistComplete, isValidKm } from '../src/services/routeStartLogic';

type StepStatus = 'pending' | 'done' | 'skip';

function StatusBadge({ status }: { status: StepStatus }) {
  if (status === 'done') return <Badge label="✓ Listo" variant="green" />;
  if (status === 'skip') return <Badge label="Sin pendiente" variant="dim" />;
  return <Badge label="Pendiente" variant="orange" />;
}

export default function RouteStartScreen() {
  const router = useRouter();
  const plan = useRouteStore((s) => s.plan);
  const loadPlan = useRouteStore((s) => s.loadPlan);
  const planId = plan?.plan_id ?? null;
  const isOnline = useSyncStore((s) => s.isOnline);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const loadProducts = useProductStore((s) => s.loadProducts);

  const setForPlan = useRouteStartStore((s) => s.setForPlan);
  const setChecklistComplete = useRouteStartStore((s) => s.setChecklistComplete);
  const setKmInitialStore = useRouteStartStore((s) => s.setKmInitial);
  const setLoadAccepted = useRouteStartStore((s) => s.setLoadAccepted);
  const kmInitialStored = useRouteStartStore((s) => s.kmInitial);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checklistStatus, setChecklistStatus] = useState<StepStatus>('pending');
  const [acceptingLoad, setAcceptingLoad] = useState(false);

  const [kmInput, setKmInput] = useState('');
  const [savingKm, setSavingKm] = useState(false);

  // Load acceptance reuses Sebas's service: the load is embedded in the plan
  // object (load_pickings / pending_loads). No extra /my-load fetch.
  const loadState = React.useMemo(() => buildRouteLoadAcceptanceState(plan), [plan]);
  const loadStatus: StepStatus =
    loadState.loadCards.length === 0 ? 'skip' : (loadState.hasPendingLoad ? 'pending' : 'done');

  // Sync the load readiness into the store whenever the plan changes.
  React.useEffect(() => {
    if (loadState.loadCards.length === 0) {
      setLoadAccepted(true); // nothing to accept → not a blocker
    } else {
      setLoadAccepted(!loadState.hasPendingLoad);
    }
  }, [loadState, setLoadAccepted]);

  // Refresh checklist status from backend when the hub is focused.
  const refresh = useCallback(async () => {
    if (!planId) {
      setLoading(false);
      return;
    }
    setForPlan(planId);
    if (!isOnline) {
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      try {
        const header = await getVehicleChecklist(planId);
        const done = isChecklistComplete(header);
        setChecklistStatus(done ? 'done' : 'pending');
        setChecklistComplete(done);
      } catch {
        setChecklistStatus('pending');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el estado de inicio.');
    } finally {
      setLoading(false);
    }
  }, [planId, isOnline, setForPlan, setChecklistComplete]);

  async function handleAcceptLoad() {
    if (!planId || acceptingLoad) return;
    const pending = loadState.nextPendingLoad;
    if (!pending?.picking_id) return;
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate al WiFi del CEDIS para aceptar la carga.');
      return;
    }
    Alert.alert(
      pending.isRefill ? 'Aceptar refill' : 'Aceptar carga',
      `¿Confirmas que recibiste el producto de "${pending.name}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Aceptar',
          onPress: async () => {
            setAcceptingLoad(true);
            try {
              await acceptRouteLoad(planId, pending.picking_id);
              await loadPlan();
              if (warehouseId) await loadProducts(warehouseId);
            } catch (err) {
              Alert.alert('Error al aceptar', err instanceof Error ? err.message : 'Intenta de nuevo.');
            } finally {
              setAcceptingLoad(false);
            }
          },
        },
      ],
    );
  }

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const kmStatus: StepStatus = kmInitialStored != null ? 'done' : 'pending';

  // BLD-SPRINT-A-FIX: readiness derived LIVE from the on-screen step status,
  // not from the store's readiness object. The store can momentarily lag on a
  // plan/day change (setForPlan resets loadAccepted before the load effect
  // re-derives it), which previously left "Iniciar ruta" stuck disabled on a
  // new day. Live derivation is the single source of truth for the button.
  const checklistDoneLive = checklistStatus === 'done';
  const kmDoneLive = kmInitialStored != null;
  const loadDoneLive = loadStatus !== 'pending'; // 'done' (accepted) or 'skip' (none)
  const readyToStartLive = checklistDoneLive && kmDoneLive && loadDoneLive;

  async function handleSaveKm() {
    if (!planId) return;
    if (savingKm) return;
    if (!isValidKm(kmInput)) {
      Alert.alert('KM inválido', 'Captura un kilometraje válido (número mayor a 0).');
      return;
    }
    const km = Math.round(parseFloat(kmInput));
    Alert.alert(
      'Confirmar KM inicial',
      `Vas a registrar ${km} km como kilometraje de salida. Esto se guarda en el servidor.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Guardar',
          onPress: async () => {
            setSavingKm(true);
            try {
              await updateKm(planId, 'departure', km);
              setKmInitialStore(km);
              setKmInput('');
            } catch (err) {
              Alert.alert('Error al guardar KM', err instanceof Error ? err.message : 'Intenta de nuevo.');
            } finally {
              setSavingKm(false);
            }
          },
        },
      ],
    );
  }

  // ── Empty state: no plan ────────────────────────────────────────────────
  if (!planId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Iniciar operación" showBack />
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>No tienes ruta asignada hoy</Text>
          <Text style={styles.emptyBody}>
            Cuando tu supervisor publique tu plan, aquí podrás hacer el checklist,
            registrar KM y aceptar tu carga.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Iniciar operación" showBack />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              📶 Sin conexión. El inicio de operación requiere WiFi del CEDIS.
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void refresh()} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 1: unidad / ruta */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.stepTitle}>1 · Unidad y ruta</Text>
          </View>
          <Text style={styles.unitName}>{plan?.route || plan?.name || 'Ruta del día'}</Text>
          <Text style={styles.unitSub}>
            {plan?.driver_employee_name ? `Chofer: ${plan.driver_employee_name}` : 'Chofer asignado'}
          </Text>
        </Card>

        {/* Step 2: checklist */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.stepTitle}>2 · Checklist de unidad</Text>
            {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <StatusBadge status={checklistStatus} />}
          </View>
          <Text style={styles.stepBody}>
            Revisa el estado de la unidad antes de salir (llantas, gas, kit, etc.).
          </Text>
          <Button
            label={checklistStatus === 'done' ? 'Ver checklist' : 'Hacer checklist'}
            variant={checklistStatus === 'done' ? 'secondary' : 'primary'}
            onPress={() => router.push(`/checklist/${planId}` as never)}
            fullWidth
            disabled={!isOnline}
          />
        </Card>

        {/* Step 3: KM inicial.
            A.1 Option A: el KM se captura UNA sola vez, en el checklist
            (check numérico "Odómetro salida"), y se registra automáticamente
            al completar. Aquí sólo se muestra el estado. El input manual es un
            FALLBACK que aparece sólo si el checklist ya quedó completo pero no
            alimentó el KM (p. ej. un template sin check de odómetro). */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.stepTitle}>3 · KM inicial</Text>
            <StatusBadge status={kmStatus} />
          </View>
          {kmInitialStored != null ? (
            <Text style={styles.stepBody}>
              Registrado: <Text style={styles.kmValue}>{kmInitialStored} km</Text>
            </Text>
          ) : checklistStatus !== 'done' ? (
            <Text style={styles.stepBody}>
              Se registra automáticamente al completar el checklist (odómetro de salida).
              No necesitas capturarlo aquí.
            </Text>
          ) : (
            <>
              <Text style={styles.stepBody}>
                El checklist no registró el KM. Captúralo manualmente para continuar.
              </Text>
              <View style={styles.kmRow}>
                <TextInput
                  style={styles.kmInput}
                  value={kmInput}
                  onChangeText={setKmInput}
                  placeholder="Ej. 123456"
                  placeholderTextColor={colors.textDim}
                  keyboardType="number-pad"
                  editable={isOnline && !savingKm}
                />
                <Button
                  label={savingKm ? 'Guardando…' : 'Guardar'}
                  variant="primary"
                  onPress={handleSaveKm}
                  disabled={!isOnline || savingKm}
                  loading={savingKm}
                />
              </View>
            </>
          )}
        </Card>

        {/* Step 4: carga (reuse Sebas's acceptRouteLoad + plan-embedded load) */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.stepTitle}>4 · Carga asignada</Text>
            <StatusBadge status={loadStatus} />
          </View>
          {loadStatus === 'skip' ? (
            <Text style={styles.stepBody}>No tienes carga pendiente de aceptar.</Text>
          ) : loadStatus === 'done' ? (
            <Text style={styles.stepBody}>✓ Tu carga ya fue aceptada.</Text>
          ) : (
            <>
              <Text style={styles.stepBody}>
                Pendiente: {loadState.nextPendingLoad?.name || 'carga asignada'}
                {loadState.nextPendingLoad?.lines?.length
                  ? `  ·  ${loadState.nextPendingLoad.lines.length} producto(s)`
                  : ''}
              </Text>
              <Button
                label={acceptingLoad ? 'Aceptando…' : (loadState.nextPendingLoad?.isRefill ? 'Aceptar refill' : 'Aceptar carga')}
                variant="primary"
                onPress={handleAcceptLoad}
                fullWidth
                disabled={!isOnline || acceptingLoad}
                loading={acceptingLoad}
              />
            </>
          )}
        </Card>

        {/* Readiness summary (live-derived — see BLD-SPRINT-A-FIX) */}
        <View style={[styles.readyCard, readyToStartLive ? styles.readyOk : styles.readyPending]}>
          <Text style={styles.readyTitle}>
            {readyToStartLive ? '✅ Listo para iniciar ruta' : 'Completa los pasos para iniciar'}
          </Text>
          <Text style={styles.readyChecklist}>
            {checklistDoneLive ? '✓' : '○'} Checklist   ·   {kmDoneLive ? '✓' : '○'} KM   ·   {loadDoneLive ? '✓' : '○'} Carga
          </Text>
          <Button
            label="Iniciar ruta"
            variant="success"
            onPress={() => {
              // BLD-SPRINT-A: "Iniciar ruta" queda PREPARADO. El wiring real
              // (transición de estado de la ruta / navegación a mapa) es de un
              // sprint posterior. Por ahora lleva al plan de paradas.
              router.replace('/(tabs)/route' as never);
            }}
            fullWidth
            disabled={!readyToStartLive}
          />
          {!readyToStartLive && (
            <Text style={styles.readyHint}>
              El botón se habilita cuando termines checklist, KM y carga.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100, gap: 12 },
  emptyIcon: { fontSize: 56, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 8 },
  emptyBody: { fontSize: 13, lineHeight: 19, color: colors.textDim, textAlign: 'center' },
  offlineBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: 'rgba(234,179,8,0.08)', borderWidth: 1, borderColor: 'rgba(234,179,8,0.4)',
  },
  offlineText: { fontSize: 12, color: colors.text },
  errorBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: 'rgba(239,68,68,0.07)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
  },
  errorText: { fontSize: 12, color: '#EF4444', marginBottom: 8 },
  retryBtn: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 14, borderRadius: radii.button, backgroundColor: colors.primary },
  retryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  stepTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  stepBody: { fontSize: 12, lineHeight: 17, color: colors.textDim, marginBottom: 10 },
  unitName: { fontSize: 16, fontWeight: '700', color: colors.primary, marginTop: 2 },
  unitSub: { fontSize: 12, color: colors.textDim, marginTop: 2 },
  kmRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  kmInput: {
    flex: 1, height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.button,
    paddingHorizontal: 14, color: colors.text, fontFamily: fonts.monoBold, fontSize: 16,
    backgroundColor: colors.card,
  },
  kmValue: { fontFamily: fonts.monoBold, fontWeight: '700', color: colors.text },
  readyCard: { padding: 16, borderRadius: radii.card, borderWidth: 1, marginTop: 4 },
  readyOk: { backgroundColor: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.35)' },
  readyPending: { backgroundColor: colors.card, borderColor: colors.border },
  readyTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 8 },
  readyChecklist: { fontSize: 13, color: colors.textDim, marginBottom: 12, fontFamily: fonts.monoBold },
  readyHint: { fontSize: 11, color: colors.textDim, marginTop: 8, textAlign: 'center' },
});
