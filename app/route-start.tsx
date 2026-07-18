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

import React, { useCallback, useRef, useState } from 'react';
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
import { useRoutePreparationStore } from '../src/stores/useRoutePreparationStore';
import { ensureChecklistReady } from '../src/services/vehicleChecklist';
import { updateKm } from '../src/services/routeKm';
import { acceptRouteLoad, startPlan } from '../src/services/gfLogistics';
import { buildInitialLoadAcceptanceState } from '../src/services/routeLoadAcceptance';
import {
  chooseAuthoritativeKm,
  isChecklistAnsweredForStart,
  isValidKm,
  isAbsurdOdometer,
} from '../src/services/routeStartLogic';
import { computeRouteReadiness } from '../src/services/routeReadiness';
import { describeRouteLoad, isErrorStatus } from '../src/services/routeLoadOutcome';
import { RoutePreparationCard } from '../src/components/domain/RoutePreparationCard';
import { confirmAuthoritativeRouteStart } from '../src/services/routeStartAction';
import {
  buildRouteStartUiState,
  isCurrentRoutePlan,
  isSameStartedRoutePlan,
} from '../src/services/routeStartUi';

type StepStatus = 'pending' | 'done' | 'skip';

function StatusBadge({ status }: { status: StepStatus }) {
  if (status === 'done') return <Badge label="✓ Listo" variant="green" />;
  if (status === 'skip') return <Badge label="Sin pendiente" variant="dim" />;
  return <Badge label="Pendiente" variant="orange" />;
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
  Alert.alert('La ruta cambió', 'La ruta cambió. Revisa el plan actual antes de continuar.');
}

export default function RouteStartScreen() {
  const router = useRouter();
  const plan = useRouteStore((s) => s.plan);
  const loadPlan = useRouteStore((s) => s.loadPlan);
  const loadOutcome = useRouteStore((s) => s.loadOutcome);
  const planId = plan?.plan_id ?? null;
  const isOnline = useSyncStore((s) => s.isOnline);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const loadProducts = useProductStore((s) => s.loadProducts);

  // Perf Fase 2C: readiness de datos (gate de salida) — ruta + productos +
  // precios precargados. Mínimo bloqueante = ruta + productos.
  const stopsCount = useRouteStore((s) => s.stops.length);
  const productCount = useProductStore((s) => s.productCount);
  const customersTotal = useRoutePreparationStore((s) => s.customersTotal);
  const customersPrepared = useRoutePreparationStore((s) => s.customersPrepared);
  const dataReady = computeRouteReadiness({
    hasPlan: !!plan,
    stopsCount,
    productCount,
    customersTotal,
    customersPrepared,
  });

  const setForPlan = useRouteStartStore((s) => s.setForPlan);
  const setChecklistCompleteForPlan = useRouteStartStore((s) => s.setChecklistCompleteForPlan);
  const setKmInitialForPlan = useRouteStartStore((s) => s.setKmInitialForPlan);
  const routeStartPlanId = useRouteStartStore((s) => s.planId);
  const checklistComplete = useRouteStartStore((s) => s.checklistComplete);
  const kmInitialStoredForPlan = useRouteStartStore((s) => s.kmInitial);
  const kmInitialStored = routeStartPlanId === planId ? kmInitialStoredForPlan : null;
  const [kmInitialBackend, setKmInitialBackend] = useState<{
    planId: number;
    km: number | null;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checklistStatus, setChecklistStatus] = useState<StepStatus>('pending');
  const [acceptingLoad, setAcceptingLoad] = useState(false);

  const [kmInput, setKmInput] = useState('');
  const [savingKm, setSavingKm] = useState(false);
  const [startingRoute, setStartingRoute] = useState(false);
  const startingRouteRef = useRef(false);
  const planDepartureKm = typeof plan?.departure_km === 'number' ? plan.departure_km : null;
  const kmInitial = chooseAuthoritativeKm({
    planKm: planDepartureKm,
    backendKm: kmInitialBackend?.planId === planId ? kmInitialBackend.km : null,
    localKm: kmInitialStored,
  });

  // Load acceptance reuses Sebas's service: the load is embedded in the plan
  // object (load_pickings / pending_loads). No extra /my-load fetch.
  const initialLoadState = React.useMemo(() => buildInitialLoadAcceptanceState(plan), [plan]);
  const loadStatus: StepStatus =
    initialLoadState.initialLoads.length === 0
      ? 'skip'
      : (initialLoadState.initialLoadAccepted ? 'done' : 'pending');

  // Refresh checklist status from backend when the hub is focused.
  const refresh = useCallback(async () => {
    if (!planId) {
      setLoading(false);
      return;
    }
    const capturedPlanId = planId;
    setForPlan(capturedPlanId);
    const currentStart = useRouteStartStore.getState();
    setChecklistStatus(
      currentStart.planId === capturedPlanId && currentStart.checklistComplete ? 'done' : 'pending',
    );
    setKmInitialBackend(null);
    if (!isOnline) {
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await loadPlan({ force: true });
      if (!isCurrentPlan(capturedPlanId)) return;
      const freshPlan = useRouteStore.getState().plan;
      setKmInitialBackend({
        planId: capturedPlanId,
        km: typeof freshPlan?.departure_km === 'number' ? freshPlan.departure_km : null,
      });
      const { header } = await ensureChecklistReady(capturedPlanId);
      // The hub creates/loads the checklist before evaluating readiness.
      // Answers are required; pass/fail does not block route start.
      const done = isChecklistAnsweredForStart(header);
      setChecklistCompleteForPlan(capturedPlanId, done);
      if (isCurrentPlan(capturedPlanId)) {
        setChecklistStatus(done ? 'done' : 'pending');
      }
    } catch {
      if (isCurrentPlan(capturedPlanId)) {
        const preservedChecklist = useRouteStartStore.getState().checklistComplete;
        setChecklistStatus(preservedChecklist ? 'done' : 'pending');
        setError('No se pudo validar el checklist de unidad. Reintenta con conexión.');
      }
    } finally {
      if (isCurrentPlan(capturedPlanId)) {
        setLoading(false);
      }
    }
  }, [planId, isOnline, loadPlan, setForPlan, setChecklistCompleteForPlan]);

  async function handleAcceptLoad() {
    if (!planId || acceptingLoad) return;
    const capturedPlanId = planId;
    const pending = initialLoadState.nextPendingInitialLoad;
    if (!pending?.picking_id) return;
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate al WiFi del CEDIS para aceptar la carga.');
      return;
    }
    Alert.alert(
      'Aceptar carga',
      `¿Confirmas que recibiste el producto de "${pending.name}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Aceptar',
          onPress: async () => {
            if (!isCurrentPlan(capturedPlanId)) {
              showRouteChangedAlert();
              return;
            }
            setAcceptingLoad(true);
            try {
              await acceptRouteLoad(capturedPlanId, pending.picking_id);
              await loadPlan({ force: true });
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

  const kmStatus: StepStatus = kmInitial != null ? 'done' : 'pending';

  const serverStarted = plan?.state === 'in_progress';
  const checklistDoneLive = serverStarted || (routeStartPlanId === planId && checklistComplete);
  const checklistDisplayStatus: StepStatus = serverStarted
    ? 'done'
    : (checklistDoneLive && checklistStatus === 'done' ? 'done' : 'pending');
  const kmDoneLive = kmInitial != null;
  const loadDoneLive = loadStatus !== 'pending'; // 'done' (accepted) or 'skip' (none)
  // Perf Fase 2C: además del checklist/KM/carga, exigir el MÍNIMO de datos en
  // caché (ruta + productos) para no salir a ruta sin con qué operar. Los
  // precios faltantes son advertencia, no bloqueo (degradación segura).
  const dataMinReady = dataReady.minimumReady;
  const readyToStartLive = checklistDoneLive && kmDoneLive && loadDoneLive && dataMinReady;
  const canRequestStart = plan?.state === 'published' && readyToStartLive && isOnline;
  const canContinue = serverStarted || canRequestStart;

  async function handleStartRoute() {
    if (!planId || startingRouteRef.current) return;
    const capturedPlanId = planId;
    const currentPlan = useRouteStore.getState().plan;
    const currentStart = useRouteStartStore.getState();
    const currentReadyToStart = currentStart.planId === capturedPlanId
      && currentStart.checklistComplete
      && currentStart.kmInitial != null
      && currentStart.loadAccepted
      && dataMinReady;
    if (currentPlan?.plan_id !== capturedPlanId) return;
    const currentUiState = buildRouteStartUiState({
      planState: currentPlan.state,
      readyToStart: currentReadyToStart,
      isOnline: useSyncStore.getState().isOnline,
    });
    if (
      !currentUiState.canContinue
      || (
        currentPlan.state !== 'in_progress'
        && !(currentPlan.state === 'published' && currentReadyToStart)
      )
    ) {
      return;
    }

    startingRouteRef.current = true;
    setStartingRoute(true);
    try {
      await confirmAuthoritativeRouteStart({
        planId: capturedPlanId,
        currentState: currentPlan.state,
        start: startPlan,
        refresh: async () => {
          await loadPlan({ force: true });
          return useRouteStore.getState().plan;
        },
        markStarted: () => useRouteStore.getState().markPlanStarted(capturedPlanId),
      });

      const confirmedPlan = useRouteStore.getState().plan;
      const confirmedStartPlanId = useRouteStartStore.getState().planId;
      const stillSameStartedPlan = isSameStartedRoutePlan({
        capturedPlanId,
        currentPlan: confirmedPlan,
        currentRouteStartPlanId: confirmedStartPlanId,
      });
      if (!stillSameStartedPlan) {
        Alert.alert(
          'La ruta cambió',
          'La ruta cambió mientras se iniciaba. Revisa el plan actual.',
        );
        return;
      }

      router.replace({ pathname: '/(tabs)/route', params: { view: 'map' } } as never);
    } catch (err) {
      Alert.alert(
        'No se pudo iniciar la ruta',
        err instanceof Error ? err.message : 'Intenta de nuevo.',
      );
    } finally {
      startingRouteRef.current = false;
      setStartingRoute(false);
    }
  }

  async function handleSaveKm() {
    if (!planId) return;
    if (savingKm) return;
    if (!isValidKm(kmInput)) {
      Alert.alert('KM inválido', 'Captura un kilometraje válido (número mayor a 0).');
      return;
    }
    const km = Math.round(parseFloat(kmInput));
    // P2: guard contra odómetro absurdo (probable typo). No bloquea: confirma.
    if (isAbsurdOdometer(km)) {
      Alert.alert(
        'KM inusualmente alto',
        `${km.toLocaleString('es-MX')} km parece un error de captura. ¿Es correcto?`,
        [
          { text: 'Corregir', style: 'cancel' },
          { text: 'Sí, es correcto', onPress: () => confirmSaveKm(km) },
        ],
      );
      return;
    }
    confirmSaveKm(km);
  }

  function confirmSaveKm(km: number) {
    if (!planId) return;
    const capturedPlanId = planId;
    Alert.alert(
      'Confirmar KM inicial',
      `Vas a registrar ${km} km como kilometraje de salida. Esto se guarda en el servidor.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Guardar',
          onPress: async () => {
            if (!isCurrentPlan(capturedPlanId)) {
              showRouteChangedAlert();
              return;
            }
            setSavingKm(true);
            try {
              const res = await updateKm(capturedPlanId, 'departure', km);
              const storedKm = res.departure_km ?? null;
              setKmInitialForPlan(capturedPlanId, storedKm);
              if (isCurrentPlan(capturedPlanId)) {
                setKmInitialBackend({ planId: capturedPlanId, km: storedKm });
              }
              await loadPlan({ force: true });
              if (isCurrentPlan(capturedPlanId)) {
                setKmInput('');
              }
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

  // ── Empty state: no plan O fallo de carga ───────────────────────────────
  // PR-2: distinguir ausencia REAL de plan (no_plan) de un fallo de carga
  // (timeout/red/servidor). El copy y el ícono se derivan del loadOutcome, y
  // se ofrece Reintentar — nunca mostrar "No tienes ruta" ante un timeout.
  if (!planId) {
    const copy = describeRouteLoad(loadOutcome);
    const isError = loadOutcome ? isErrorStatus(loadOutcome.status) : false;
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Iniciar operación" showBack />
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>{isError ? '⚠️' : '📭'}</Text>
          <Text style={styles.emptyTitle}>{copy.title}</Text>
          <Text style={styles.emptyBody}>{copy.body}</Text>
          {copy.showRetry && (
            <TouchableOpacity
              onPress={() => { void loadPlan({ force: true }); }}
              style={styles.retryBtn}
              disabled={!isOnline}
            >
              <Text style={styles.retryBtnText}>
                {isOnline ? 'Reintentar' : 'Sin conexión'}
              </Text>
            </TouchableOpacity>
          )}
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

        {/* PR-2: plan cargado pero sus paradas fallaron (o acceso denegado):
            surface el motivo real con retry, en vez de una ruta vacía silenciosa. */}
        {loadOutcome && isErrorStatus(loadOutcome.status) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{describeRouteLoad(loadOutcome).title}</Text>
            <Text style={styles.errorBody}>{describeRouteLoad(loadOutcome).body}</Text>
            <TouchableOpacity
              onPress={() => { void loadPlan({ force: true }); }}
              style={styles.retryBtn}
              disabled={!isOnline}
            >
              <Text style={styles.retryBtnText}>{isOnline ? 'Reintentar' : 'Sin conexión'}</Text>
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
            {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <StatusBadge status={checklistDisplayStatus} />}
          </View>
          <Text style={styles.stepBody}>
            Revisa el estado de la unidad antes de salir (llantas, gas, kit, etc.).
          </Text>
          <Button
            label={checklistDisplayStatus === 'done' ? 'Ver checklist' : 'Hacer checklist'}
            variant={checklistDisplayStatus === 'done' ? 'secondary' : 'primary'}
            onPress={() => router.push(`/checklist/${planId}` as never)}
            fullWidth
            disabled={!isOnline}
          />
        </Card>

        {/* Step 3: KM inicial.
            A.1 Option A: si el checklist trae "Odómetro salida", se registra
            automáticamente al completar. El input manual queda disponible como
            fallback para no depender del template del checklist. */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.stepTitle}>3 · KM inicial</Text>
            <StatusBadge status={kmStatus} />
          </View>
          {kmInitial != null ? (
            <Text style={styles.stepBody}>
              Registrado en Odoo: <Text style={styles.kmValue}>{kmInitial} km</Text>
            </Text>
          ) : (
            <>
              <Text style={styles.stepBody}>
                {checklistDisplayStatus === 'done'
                  ? 'El checklist no registró el KM. Captúralo manualmente para continuar.'
                  : 'Puede registrarse automáticamente al completar el checklist; si vas a operar ahora, captura el KM inicial aquí.'}
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
                Pendiente: {initialLoadState.nextPendingInitialLoad?.name || 'carga asignada'}
                {initialLoadState.nextPendingInitialLoad?.lines?.length
                  ? `  ·  ${initialLoadState.nextPendingInitialLoad.lines.length} producto(s)`
                  : ''}
              </Text>
              <Button
                label={acceptingLoad ? 'Aceptando…' : 'Aceptar carga'}
                variant="primary"
                onPress={handleAcceptLoad}
                fullWidth
                disabled={!isOnline || acceptingLoad}
                loading={acceptingLoad}
              />
            </>
          )}
        </Card>

        {/* Step 5: preparar datos de ruta (Fase 2C) — reusa el orquestador
            (useRoutePreparationStore) vía RoutePreparationCard: progreso,
            faltantes, errores por-cliente y reintentar. */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.stepTitle}>5 · Preparar datos de ruta</Text>
            <StatusBadge status={dataMinReady ? 'done' : 'pending'} />
          </View>
          <Text style={styles.stepBody}>
            Descarga clientes, productos y precios con WiFi para operar offline en ruta.
          </Text>
          <RoutePreparationCard />
        </Card>

        {/* Readiness summary (live-derived — see BLD-SPRINT-A-FIX) */}
        <View style={[styles.readyCard, canContinue ? styles.readyOk : styles.readyPending]}>
          <Text style={styles.readyTitle}>
            {serverStarted
              ? '✅ Ruta iniciada'
              : (canRequestStart ? '✅ Listo para iniciar ruta' : 'Completa los pasos para iniciar')}
          </Text>
          <Text style={styles.readyChecklist}>
            {checklistDoneLive ? '✓' : '○'} Checklist   ·   {kmDoneLive ? '✓' : '○'} KM   ·   {loadDoneLive ? '✓' : '○'} Carga   ·   {dataMinReady ? '✓' : '○'} Datos
          </Text>
          {!checklistDoneLive && (
            <Text style={styles.readyWarn}>⚠️ Checklist de unidad pendiente. Responde todos los puntos para actualizar el estado del vehículo.</Text>
          )}
          {dataMinReady && dataReady.warnings.length > 0 && (
            <Text style={styles.readyWarn}>⚠️ {dataReady.warnings.join('; ')}. Se completan al abrir cada cliente con señal.</Text>
          )}
          <Button
            label={serverStarted ? 'Continuar ruta' : 'Iniciar ruta'}
            variant="success"
            onPress={handleStartRoute}
            fullWidth
            disabled={startingRoute || !canContinue}
            loading={startingRoute}
          />
          {!canContinue && (
            <Text style={styles.readyHint}>
              {!dataMinReady && dataReady.blockReason
                ? dataReady.blockReason
                : 'El botón se habilita cuando termines checklist, KM, carga y preparación de datos.'}
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
  errorBody: { fontSize: 12, color: colors.textDim, marginBottom: 8 },
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
  readyWarn: { fontSize: 11, color: '#B45309', marginBottom: 10, lineHeight: 16 },
  readyHint: { fontSize: 11, color: colors.textDim, marginTop: 8, textAlign: 'center' },
});
