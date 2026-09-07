/**
 * Route Start hub — Sprint A.
 *
 * Orchestrates the morning sequence BEFORE leaving the CEDIS:
 *   1. Checklist de unidad (server-confirmed)
 *   2. Aceptar o rechazar carga
 *   3. Preparar plan del día (full operational bundle)
 *   4. Iniciar ruta
 *
 * Minimal bootstrap (plan/vehicle/checklist/load metadata) may load first.
 * Full day preparation waits until load is authoritatively accepted.
 * KM inicial is captured from the checklist odometer; a manual fallback
 * appears only when that value is missing.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
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
import { useEmployeeDayBundleStore } from '../src/stores/useEmployeeDayBundleStore';
import { ensureChecklistReady } from '../src/services/vehicleChecklist';
import { updateKm } from '../src/services/routeKm';
import { acceptRouteLoad, rejectRouteLoad, startPlan } from '../src/services/gfLogistics';
import {
  describeRouteLoadAcceptSuccess,
  evaluateInventoryRefreshEvidence,
  evaluatePlanRefreshEvidence,
  requirePositivePickingId,
  runRouteLoadAcceptAndRefresh,
} from '../src/services/routeLoadAcceptFlow';
import {
  buildInitialLoadAcceptanceState,
  buildRouteLoadRejectPayload,
  createRouteLoadOperationId,
  ROUTE_LOAD_REJECTION_REASON_CODES,
  ROUTE_LOAD_REJECTION_REASON_LABELS,
  type RouteLoadRejectionReasonCode,
} from '../src/services/routeLoadAcceptance';
import { logWarn } from '../src/utils/logger';
import {
  chooseAuthoritativeKm,
  computeStartDayStepGates,
  isChecklistServerConfirmed,
  isValidKm,
  isAbsurdOdometer,
  START_DAY_COPY,
} from '../src/services/routeStartLogic';
import { computeRouteReadiness } from '../src/services/routeReadiness';
import { describeRouteLoad, isErrorStatus } from '../src/services/routeLoadOutcome';
import { RoutePreparationCard } from '../src/components/domain/RoutePreparationCard';
import { confirmAuthoritativeRouteStart } from '../src/services/routeStartAction';
import { hasQueuedChecklistCompleteForPlan } from '../src/services/vehicleChecklistOffline';
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
  const isPotentiallyOnline = useSyncStore((s) => s.isPotentiallyOnline);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const loadProducts = useProductStore((s) => s.loadProducts);
  const loadProductsAuthoritative = useProductStore((s) => s.loadProductsAuthoritative);
  const dayBundleAccess = useEmployeeDayBundleStore((s) => s.access);
  const hydrateDayBundle = useEmployeeDayBundleStore((s) => s.hydrate);

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
  const [checklistSyncPending, setChecklistSyncPending] = useState(false);
  const [acceptingLoad, setAcceptingLoad] = useState(false);
  const [rejectingLoad, setRejectingLoad] = useState(false);
  const [rejectPickerOpen, setRejectPickerOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState<RouteLoadRejectionReasonCode | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

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
    initialLoadState.initialLoadRejectedWaiting
      ? 'pending'
      : initialLoadState.initialLoads.length === 0
        ? 'skip'
        : (initialLoadState.initialLoadAccepted ? 'done' : 'pending');

  // Refresh checklist status from backend when the hub is focused.
  const refresh = useCallback(async () => {
    await hydrateDayBundle();
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
    const queuedComplete = hasQueuedChecklistCompleteForPlan(
      useSyncStore.getState().queue,
      capturedPlanId,
    );
    if (!isOnline) {
      const preserved = useRouteStartStore.getState();
      const serverConfirmed = preserved.planId === capturedPlanId && preserved.checklistComplete;
      setChecklistSyncPending(queuedComplete && !serverConfirmed);
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
      // Hub unlock for Load uses server-confirmed complete, not answers-only.
      const done = isChecklistServerConfirmed(header);
      setChecklistCompleteForPlan(capturedPlanId, done);
      if (isCurrentPlan(capturedPlanId)) {
        setChecklistStatus(done ? 'done' : 'pending');
        setChecklistSyncPending(!done && (
          queuedComplete || hasQueuedChecklistCompleteForPlan(
            useSyncStore.getState().queue,
            capturedPlanId,
          )
        ));
      }
    } catch {
      if (isCurrentPlan(capturedPlanId)) {
        const preservedChecklist = useRouteStartStore.getState().checklistComplete;
        setChecklistStatus(preservedChecklist ? 'done' : 'pending');
        setChecklistSyncPending(queuedComplete && !preservedChecklist);
        setError('No se pudo validar el checklist de unidad. Reintenta con conexión.');
      }
    } finally {
      if (isCurrentPlan(capturedPlanId)) {
        setLoading(false);
      }
    }
  }, [planId, isOnline, loadPlan, setForPlan, setChecklistCompleteForPlan, hydrateDayBundle]);

  async function handleAcceptLoad() {
    if (!planId || acceptingLoad) return;
    const capturedPlanId = planId;
    const pending = initialLoadState.nextPendingInitialLoad;
    if (!pending?.picking_id) return;
    // Capture exact picking before any await / confirmation dialog.
    const pickingId = requirePositivePickingId(pending.picking_id);
    const pickingName = pending.name;
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate al WiFi del CEDIS para aceptar la carga.');
      return;
    }
    Alert.alert(
      'Aceptar carga',
      `¿Confirmas que recibiste el producto de "${pickingName}"?`,
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
              const outcome = await runRouteLoadAcceptAndRefresh({
                planId: capturedPlanId,
                pickingId,
                warehouseId,
                isOnline: true,
                accept: acceptRouteLoad,
                refreshPlan: async () => {
                  await loadPlan({ force: true });
                  const snap = useRouteStore.getState();
                  return evaluatePlanRefreshEvidence({
                    expectedPlanId: capturedPlanId,
                    plan: snap.plan,
                    routeFreshness: snap.routeFreshness,
                  });
                },
                refreshInventory: async () => {
                  const result = await loadProductsAuthoritative();
                  return evaluateInventoryRefreshEvidence(result);
                },
                offlineMessage: 'Conéctate al WiFi del CEDIS para aceptar la carga.',
              });
              const copy = describeRouteLoadAcceptSuccess({
                isRefill: false,
                pickingName,
                idempotentReplay: outcome.accept.idempotent_replay,
                inventoryRefreshOk: outcome.inventoryRefreshOk && outcome.planRefreshOk,
              });
              if (!outcome.inventoryRefreshOk || !outcome.planRefreshOk) {
                logWarn('inventory', 'route_load_accept_refresh_failed', {
                  plan_id: capturedPlanId,
                  picking_id: pickingId,
                  plan_refresh_ok: outcome.planRefreshOk,
                  plan_refresh_reason: outcome.planRefreshReason,
                  inventory_refresh_ok: outcome.inventoryRefreshOk,
                  error: outcome.inventoryRefreshError,
                });
              }
              Alert.alert(copy.title, copy.body);
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

  function closeRejectPicker(): void {
    setRejectPickerOpen(false);
    setRejectReason(null);
    setRejectNotes('');
  }

  async function confirmRejectLoad(): Promise<void> {
    if (!planId || rejectingLoad || acceptingLoad) return;
    const capturedPlanId = planId;
    const pending = initialLoadState.nextPendingInitialLoad;
    if (!pending?.picking_id) return;
    const pickingId = requirePositivePickingId(pending.picking_id);
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate al WiFi del CEDIS para rechazar la carga.');
      return;
    }
    if (!rejectReason) {
      Alert.alert('Motivo requerido', 'Selecciona el motivo del rechazo.');
      return;
    }
    let payload: ReturnType<typeof buildRouteLoadRejectPayload>;
    try {
      payload = buildRouteLoadRejectPayload({
        planId: capturedPlanId,
        pickingId,
        operationId: createRouteLoadOperationId(),
        rejectionReasonCode: rejectReason,
        rejectionNotes: rejectNotes,
      });
    } catch (err) {
      Alert.alert('Rechazo inválido', err instanceof Error ? err.message : 'Revisa el motivo y las notas.');
      return;
    }

    Alert.alert(
      'Rechazar carga',
      `¿Confirmas el rechazo de "${pending.name}"? Almacén deberá corregirla. Cancelar no rechaza.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Rechazar',
          style: 'destructive',
          onPress: async () => {
            if (!isCurrentPlan(capturedPlanId)) {
              showRouteChangedAlert();
              return;
            }
            setRejectingLoad(true);
            try {
              await rejectRouteLoad(capturedPlanId, pickingId, {
                operationId: String(payload.operation_id),
                rejectionReasonCode: String(payload.rejection_reason_code),
                rejectionNotes: String(payload.rejection_notes || ''),
              });
              closeRejectPicker();
              await loadPlan({ force: true });
              Alert.alert(
                'Carga rechazada',
                'Esperando corrección de Almacén. No se otorgó stock a la unidad.',
              );
            } catch (err) {
              Alert.alert(
                'No se pudo rechazar la carga',
                err instanceof Error ? err.message : 'Intenta de nuevo.',
              );
            } finally {
              setRejectingLoad(false);
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
  const checklistDoneLive = routeStartPlanId === planId && checklistComplete;
  const checklistDisplayStatus: StepStatus = checklistDoneLive && checklistStatus === 'done'
    ? 'done'
    : 'pending';
  const kmDoneLive = kmInitial != null;
  const loadAcceptedLive = initialLoadState.initialLoadAccepted;
  const dataMinReady = dataReady.minimumReady && dayBundleAccess?.canStartRoute === true;
  const startDayGates = computeStartDayStepGates({
    checklistServerConfirmed: checklistDoneLive,
    checklistSyncPending,
    initialLoadAccepted: loadAcceptedLive,
    initialLoadRejectedWaiting: initialLoadState.initialLoadRejectedWaiting,
    kmCaptured: kmDoneLive,
    dataMinimumReady: dataMinReady,
    isOnline: isPotentiallyOnline,
  });
  const readyToStartLive = startDayGates.startUnlocked;
  const canRequestStart = plan?.state === 'published' && readyToStartLive && isPotentiallyOnline;
  const canContinue = (serverStarted && readyToStartLive) || canRequestStart;

  async function handleStartRoute() {
    if (!planId || startingRouteRef.current) return;
    const capturedPlanId = planId;
    const currentPlan = useRouteStore.getState().plan;
    const currentStart = useRouteStartStore.getState();
    const currentInitial = buildInitialLoadAcceptanceState(currentPlan);
    const currentBundle = useEmployeeDayBundleStore.getState().access;
    const currentDataReady = computeRouteReadiness({
      hasPlan: !!currentPlan,
      stopsCount: useRouteStore.getState().stops.length,
      productCount: useProductStore.getState().productCount,
      customersTotal: useRoutePreparationStore.getState().customersTotal,
      customersPrepared: useRoutePreparationStore.getState().customersPrepared,
    });
    const currentKm = chooseAuthoritativeKm({
      planKm: typeof currentPlan?.departure_km === 'number' ? currentPlan.departure_km : null,
      backendKm: kmInitialBackend?.planId === capturedPlanId ? kmInitialBackend.km : null,
      localKm: currentStart.planId === capturedPlanId ? currentStart.kmInitial : null,
    });
    const currentDataMinReady = currentDataReady.minimumReady && currentBundle?.canStartRoute === true;
    const currentGates = computeStartDayStepGates({
      checklistServerConfirmed: currentStart.planId === capturedPlanId && currentStart.checklistComplete,
      checklistSyncPending: hasQueuedChecklistCompleteForPlan(
        useSyncStore.getState().queue,
        capturedPlanId,
      ) && !(currentStart.planId === capturedPlanId && currentStart.checklistComplete),
      initialLoadAccepted: currentInitial.initialLoadAccepted,
      initialLoadRejectedWaiting: currentInitial.initialLoadRejectedWaiting,
      kmCaptured: currentKm != null,
      dataMinimumReady: currentDataMinReady,
      isOnline: useSyncStore.getState().isPotentiallyOnline,
    });
    const currentReadyToStart = currentGates.startUnlocked;
    if (currentPlan?.plan_id !== capturedPlanId) return;
    if (!currentBundle?.canStartRoute) return;
    const currentUiState = buildRouteStartUiState({
      planState: currentPlan.state,
      readyToStart: currentReadyToStart,
      isOnline: useSyncStore.getState().isPotentiallyOnline,
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
          <Text style={typography.stateIcon}>{isError ? '⚠️' : '📭'}</Text>
          <Text style={[typography.screenTitle, styles.emptyTitle]}>{copy.title}</Text>
          <Text style={[typography.bodySmall, styles.emptyBody]}>{copy.body}</Text>
          {copy.showRetry && (
            <TouchableOpacity
              onPress={() => { void loadPlan({ force: true }); }}
              style={styles.retryBtn}
              disabled={!isOnline}
            >
              <Text style={typography.buttonSmall}>
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Text style={[typography.dim, styles.offlineText]}>
              📶 Sin conexión. El inicio de operación requiere WiFi del CEDIS.
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={[typography.dim, styles.errorText]}>{error}</Text>
            <TouchableOpacity onPress={() => void refresh()} style={styles.retryBtn}>
              <Text style={typography.buttonSmall}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* PR-2: plan cargado pero sus paradas fallaron (o acceso denegado):
            surface el motivo real con retry, en vez de una ruta vacía silenciosa. */}
        {loadOutcome && isErrorStatus(loadOutcome.status) && (
          <View style={styles.errorBanner}>
            <Text style={[typography.dim, styles.errorText]}>{describeRouteLoad(loadOutcome).title}</Text>
            <Text style={[typography.dim, styles.errorBody]}>{describeRouteLoad(loadOutcome).body}</Text>
            <TouchableOpacity
              onPress={() => { void loadPlan({ force: true }); }}
              style={styles.retryBtn}
              disabled={!isOnline}
            >
              <Text style={typography.buttonSmall}>{isOnline ? 'Reintentar' : 'Sin conexión'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Unidad / ruta — context, not a numbered gate */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={typography.cardHeading}>Unidad y ruta</Text>
          </View>
          <Text style={[typography.cardValue, styles.unitName]}>{plan?.route || plan?.name || 'Ruta del día'}</Text>
          <Text style={[typography.dim, styles.unitSub]}>
            {plan?.driver_employee_name ? `Chofer: ${plan.driver_employee_name}` : 'Chofer asignado'}
          </Text>
        </Card>

        {/* 1 Checklist */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={typography.cardHeading}>1 · Checklist de unidad</Text>
            {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <StatusBadge status={checklistDisplayStatus} />}
          </View>
          <Text style={[typography.dim, styles.stepBody]}>
            Revisa el estado de la unidad antes de salir (llantas, gas, kit, etc.).
          </Text>
          {checklistSyncPending && (
            <Text style={[typography.dimSmall, styles.readyWarn]}>{START_DAY_COPY.checklistSyncPending}</Text>
          )}
          <Button
            label={checklistDisplayStatus === 'done' ? 'Ver checklist' : 'Hacer checklist'}
            variant={checklistDisplayStatus === 'done' ? 'secondary' : 'primary'}
            onPress={() => router.push(`/checklist/${planId}` as never)}
            fullWidth
          />
        </Card>

        {/* KM fallback — not a numbered step. Only when odometer did not register. */}
        {kmInitial == null && (
          <Card>
            <View style={styles.rowBetween}>
              <Text style={typography.cardHeading}>Capturar KM inicial</Text>
              <StatusBadge status={kmStatus} />
            </View>
            <Text style={[typography.dim, styles.stepBody]}>
              {checklistDisplayStatus === 'done'
                ? 'El checklist no registró el KM. Captúralo aquí para continuar.'
                : 'Se registra automáticamente con el odómetro del checklist. Úsalo solo si hace falta.'}
            </Text>
            <View style={styles.kmRow}>
              <TextInput
                style={[typography.scoreValue, styles.kmInput]}
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
          </Card>
        )}

        {/* 2 Carga — locked until checklist is server-confirmed */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={typography.cardHeading}>2 · Carga</Text>
            <StatusBadge status={
              !startDayGates.loadUnlocked
                ? 'pending'
                : initialLoadState.initialLoadRejectedWaiting
                  ? 'pending'
                  : loadStatus
            } />
          </View>
          {!startDayGates.loadUnlocked ? (
            <Text style={[typography.dim, styles.stepBody]}>
              {startDayGates.loadLockMessage}
            </Text>
          ) : loadStatus === 'skip' ? (
            <Text style={[typography.dim, styles.stepBody]}>No tienes carga pendiente de aceptar.</Text>
          ) : loadStatus === 'done' ? (
            <Text style={[typography.dim, styles.stepBody]}>✓ Tu carga ya fue aceptada.</Text>
          ) : initialLoadState.initialLoadRejectedWaiting ? (
            <Text style={[typography.dim, styles.stepBody]}>{START_DAY_COPY.loadRejectedWaiting}</Text>
          ) : (
            <>
              <Text style={[typography.dim, styles.stepBody]}>
                Pendiente: {initialLoadState.nextPendingInitialLoad?.name || 'carga asignada'}
                {initialLoadState.nextPendingInitialLoad?.lines?.length
                  ? `  ·  ${initialLoadState.nextPendingInitialLoad.lines.length} producto(s)`
                  : ''}
              </Text>
              {!!initialLoadState.nextPendingInitialLoad?.lines?.length && (
                <View style={styles.loadLines}>
                  {initialLoadState.nextPendingInitialLoad.lines.map((line, index) => (
                    <View key={line.move_id || `${line.product_id}-${index}`} style={styles.loadLineRow}>
                      <Text style={[typography.dim, styles.loadLineName]} numberOfLines={2}>{line.product_name}</Text>
                      <Text style={[typography.bodySmall, styles.loadLineQty]}>
                        {Number.isInteger(line.display_qty || line.done_qty || line.requested_qty)
                          ? String(line.display_qty || line.done_qty || line.requested_qty)
                          : (line.display_qty || line.done_qty || line.requested_qty).toFixed(2)} {line.uom_name || ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.loadActions}>
                <Button
                  label={rejectingLoad ? 'Rechazando…' : 'Rechazar carga'}
                  variant="danger"
                  onPress={() => {
                    if (!isOnline) {
                      Alert.alert('Sin conexión', 'Conéctate al WiFi del CEDIS para rechazar la carga.');
                      return;
                    }
                    setRejectPickerOpen(true);
                  }}
                  disabled={!isOnline || acceptingLoad || rejectingLoad}
                  small
                />
                <Button
                  label={acceptingLoad ? 'Aceptando…' : 'Aceptar carga'}
                  variant="primary"
                  onPress={handleAcceptLoad}
                  disabled={!isOnline || acceptingLoad || rejectingLoad}
                  loading={acceptingLoad}
                  small
                />
              </View>
              {rejectPickerOpen && (
                <View style={styles.rejectBox}>
                  <Text style={[typography.dim, styles.stepBody]}>Motivo del rechazo</Text>
                  {ROUTE_LOAD_REJECTION_REASON_CODES.map((code) => (
                    <TouchableOpacity
                      key={code}
                      style={[styles.reasonChip, rejectReason === code && styles.reasonChipOn]}
                      onPress={() => setRejectReason(code)}
                    >
                      <Text style={[typography.bodySmall, rejectReason === code && styles.reasonChipTextOn]}>
                        {ROUTE_LOAD_REJECTION_REASON_LABELS[code]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {rejectReason === 'other' && (
                    <TextInput
                      style={[typography.body, styles.reasonNotes]}
                      value={rejectNotes}
                      onChangeText={setRejectNotes}
                      placeholder="Notas (obligatorias)"
                      placeholderTextColor={colors.textDim}
                      multiline
                    />
                  )}
                  <View style={styles.loadActions}>
                    <Button
                      label="Cancelar"
                      variant="secondary"
                      onPress={closeRejectPicker}
                      disabled={rejectingLoad}
                      small
                    />
                    <Button
                      label="Confirmar rechazo"
                      variant="danger"
                      onPress={() => { void confirmRejectLoad(); }}
                      disabled={rejectingLoad || !rejectReason}
                      loading={rejectingLoad}
                      small
                    />
                  </View>
                </View>
              )}
            </>
          )}
        </Card>

        {/* 3 Preparar plan del día */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={typography.cardHeading}>3 · Preparar plan del día</Text>
            <StatusBadge status={dataMinReady ? 'done' : 'pending'} />
          </View>
          <Text style={[typography.dim, styles.stepBody]}>
            Descarga clientes, productos y precios con WiFi para operar offline en ruta.
          </Text>
          <RoutePreparationCard
            locked={!startDayGates.prepareUnlocked}
            lockMessage={startDayGates.prepareLockMessage}
          />
        </Card>

        {/* 4 Iniciar ruta */}
        <View style={[styles.readyCard, canContinue ? styles.readyOk : styles.readyPending]}>
          <Text style={typography.cardHeading}>4 · Iniciar ruta</Text>
          <Text style={[typography.screenTitle, styles.readyTitle]}>
            {serverStarted
              ? '✅ Ruta iniciada'
              : (canRequestStart ? '✅ Listo para iniciar ruta' : 'Completa los pasos para iniciar')}
          </Text>
          <Text style={[typography.scoreValueSmall, styles.readyChecklist]}>
            {checklistDoneLive ? '✓' : '○'} Checklist   ·   {kmDoneLive ? '✓' : '○'} KM   ·   {loadAcceptedLive ? '✓' : '○'} Carga   ·   {dataMinReady ? '✓' : '○'} Datos
          </Text>
          {!checklistDoneLive && (
            <Text style={[typography.dimSmall, styles.readyWarn]}>
              {checklistSyncPending
                ? `⚠️ ${START_DAY_COPY.checklistSyncPending}. La carga permanece bloqueada.`
                : '⚠️ Checklist de unidad pendiente. Completa y sincroniza la inspección para continuar.'}
            </Text>
          )}
          {checklistDoneLive && initialLoadState.initialLoadRejectedWaiting && (
            <Text style={[typography.dimSmall, styles.readyWarn]}>⚠️ {START_DAY_COPY.loadRejectedWaiting}</Text>
          )}
          {dataMinReady && dataReady.warnings.length > 0 && (
            <Text style={[typography.dimSmall, styles.readyWarn]}>⚠️ {dataReady.warnings.join('; ')}. Se completan al abrir cada cliente con señal.</Text>
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
            <Text style={[typography.dimSmall, styles.readyHint]}>
              {!dataMinReady && dataReady.blockReason
                ? dataReady.blockReason
                : 'El botón se habilita cuando termines checklist, carga y preparación de datos.'}
            </Text>
          )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100, gap: 12 },
  emptyTitle: { textAlign: 'center', marginBottom: 8 },
  emptyBody: { color: colors.textDim, lineHeight: 19, textAlign: 'center' },
  offlineBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: colors.warningAlpha08, borderWidth: 1, borderColor: 'rgba(180,83,9,0.4)',
  },
  offlineText: { color: colors.text },
  errorBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: colors.errorAlpha08, borderWidth: 1, borderColor: 'rgba(185,28,28,0.4)',
  },
  errorText: { color: colors.error, marginBottom: 8 },
  errorBody: { color: colors.textDim, marginBottom: 8 },
  retryBtn: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 14, borderRadius: radii.button, backgroundColor: colors.primary },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  stepBody: { color: colors.textDim, lineHeight: 17, marginBottom: 10 },
  unitName: { color: colors.primary, marginTop: 2 },
  unitSub: { marginTop: 2 },
  kmRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  kmInput: {
    flex: 1, height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.button,
    paddingHorizontal: 14, backgroundColor: colors.card,
  },
  kmValue: { fontFamily: fonts.monoBold, fontWeight: '700', color: colors.text },
  loadLines: {
    borderRadius: radii.button,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
    marginBottom: 10,
  },
  loadLineRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  loadLineName: { flex: 1, color: colors.text },
  loadLineQty: { fontWeight: '700', color: colors.text, textAlign: 'right' },
  loadActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
  rejectBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    gap: 8,
  },
  reasonChip: {
    minHeight: 40,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  reasonChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  reasonChipTextOn: { color: '#FFFFFF' },
  reasonNotes: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.text,
    backgroundColor: colors.card,
  },
  readyCard: { padding: 16, borderRadius: radii.card, borderWidth: 1, marginTop: 4 },
  readyOk: { backgroundColor: colors.successAlpha08, borderColor: 'rgba(22,101,52,0.35)' },
  readyPending: { backgroundColor: colors.card, borderColor: colors.border },
  readyTitle: { marginBottom: 8 },
  readyChecklist: { color: colors.textDim, marginBottom: 12 },
  readyWarn: { color: colors.warning, marginBottom: 10, lineHeight: 16 },
  readyHint: { color: colors.textDim, marginTop: 8, textAlign: 'center' },
});
