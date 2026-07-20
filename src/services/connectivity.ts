/**
 * Network connectivity monitor.
 *
 * Uses @react-native-community/netinfo to detect online/offline and updates
 * useSyncStore.isOnline. PR-1 adds two extra "wakeup" triggers so the queue
 * actually drains when signal returns:
 *
 *   1. NetInfo transition — tri-state edge (`shouldWakeOnNetTransition`) that
 *      also re-wakes when reachability is CONFIRMED true after a phantom-online
 *      window (reachable === null), which a plain offline→online bool missed.
 *   2. AppState → 'active' — JS is suspended in background, so NetInfo edges
 *      that happen while suspended are lost. On foreground we re-check
 *      connectivity and kick the queue.
 *
 * The backoff wake (third trigger) lives in useSyncStore.scheduleWake().
 * None of these send anything directly — they only invoke processQueue, whose
 * `isSyncing` guard prevents concurrent cycles / double sends.
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { AppState, AppStateStatus } from 'react-native';
import { useSyncStore } from '../stores/useSyncStore';
import { useProductStore } from '../stores/useProductStore';
import { useAuthStore } from '../stores/useAuthStore';
import { shouldWakeOnNetTransition, shouldWakeOnWarehouseTransition, NetSnapshot } from './syncWakeup';
import { createLegacyRefreshRunner } from './legacyRefreshRunner';
import { logWarn } from '../utils/logger';

let netUnsubscribe: (() => void) | null = null;
let appStateSubscription: { remove: () => void } | null = null;
/** Suscripción al store de auth: dispara el refresh cuando aparece/cambia el
 * warehouse tras el arranque (P2). Única; se limpia en stopConnectivityMonitor. */
let authUnsubscribe: (() => void) | null = null;

/** Última lectura tri-estado de NetInfo, para decidir el flanco de despertar. */
let prevNet: NetSnapshot = { isConnected: null, isInternetReachable: null };

function toSnapshot(state: NetInfoState): NetSnapshot {
  return {
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
  };
}

function isOnlineFromState(state: NetInfoState | NetSnapshot): boolean {
  return !!(state.isConnected && state.isInternetReachable !== false);
}

/**
 * Runner del refresh autoritativo de inventario pendiente tras migrar eventos
 * legacy refill/unload. Contrato: la bandera DURABLE `legacyRefreshPending` solo
 * se limpia (`markLegacyRefreshCompleted`) tras una carga AUTORITATIVA
 * (`loadProductsAuthoritative`: fuente scoped, warehouse correcto, no
 * global_legacy) Y su limpieza durable confirmada. El guard in-flight (dentro del
 * runner) evita dos refresh simultáneos si red/foreground/warehouse caen juntos.
 * SINGLETON: NetInfo, foreground, rehydrate y auth comparten este mismo runner.
 */
const legacyRefreshRunner = createLegacyRefreshRunner({
  hasPending: () => useSyncStore.getState().hasLegacyRefreshPending(),
  isOnline: () => useSyncStore.getState().isOnline,
  getWarehouseId: () => useAuthStore.getState().warehouseId,
  // P1-2: resultado AUTORITATIVO explícito (fuente scoped, warehouse correcto).
  loadAuthoritative: (warehouseId: number) =>
    useProductStore.getState().loadProductsAuthoritative(warehouseId),
  // Limpieza durable verificable (async): rechaza si no se pudo persistir el false.
  markCompleted: () => useSyncStore.getState().markLegacyRefreshCompleted(),
  onError: (error) =>
    logWarn('inventory', 'legacy_authoritative_refresh_failed', {
      message: error instanceof Error ? error.message : String(error),
    }),
  onNonAuthoritative: (result) =>
    logWarn('inventory', 'legacy_refresh_non_authoritative', {
      reason: result.ok ? undefined : result.reason,
      source: result.source,
    }),
});

/**
 * Dispara UN intento de refresh autoritativo pendiente. El runner protege por
 * pending / online / warehouse / in-flight, así que es seguro llamarlo en
 * cualquier punto de despertar (reconexión, foreground, fin de bootstrap).
 * Fire-and-forget: nunca bloquea processQueue ni lanza.
 */
export function requestLegacyAuthoritativeRefresh(): void {
  void legacyRefreshRunner.run();
}

/** Dispara el drenaje de la cola sin duplicar ciclos (guard isSyncing). */
function wakeQueue(): void {
  const store = useSyncStore.getState();
  store.processQueue();
  store.scheduleWake();
  requestLegacyAuthoritativeRefresh();
}

export function startConnectivityMonitor(): void {
  if (netUnsubscribe) return; // Already listening

  netUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const next = toSnapshot(state);
    const isNowOnline = isOnlineFromState(state);

    useSyncStore.getState().setOnline(isNowOnline);

    // PR-1: despertar en transiciones relevantes (incluye phantom→real), no
    // solo en el flanco booleano offline→online.
    if (shouldWakeOnNetTransition(prevNet, next)) {
      if (__DEV__) console.log('[connectivity] wake on net transition — draining queue');
      wakeQueue();
    } else if (!isNowOnline) {
      if (__DEV__) console.log('[connectivity] Went offline');
    }

    prevNet = next;
  });

  // PR-1: foreground-resume wake. Los eventos de NetInfo que ocurren con la app
  // suspendida en background se pierden; al volver a 'active' re-verificamos la
  // conectividad y despertamos la cola.
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status !== 'active') return;
      void checkConnectivity()
        .then(() => {
          if (useSyncStore.getState().isOnline) {
            if (__DEV__) console.log('[connectivity] foreground active — draining queue');
            wakeQueue();
          }
        })
        .catch(() => {});
    });
  }

  // P2: suscripción REAL al store de auth. Cuando warehouseId pasa de
  // null/0 a un valor válido (o cambia de almacén) DESPUÉS del arranque —el caso
  // en que rehydrate encontró pending pero aún no había warehouse— disparamos el
  // MISMO runner singleton (no polling, no hook React, no runner nuevo). Solo si
  // hay pending; el runner revalida que la carga corresponda al warehouse.
  if (!authUnsubscribe) {
    authUnsubscribe = useAuthStore.subscribe((state, prev) => {
      const hasPending = useSyncStore.getState().hasLegacyRefreshPending();
      if (shouldWakeOnWarehouseTransition(prev.warehouseId, state.warehouseId, hasPending)) {
        if (__DEV__) console.log('[connectivity] warehouse available — legacy refresh');
        requestLegacyAuthoritativeRefresh();
      }
    });
  }

  if (__DEV__) console.log('[connectivity] Monitor started');
}

export function stopConnectivityMonitor(): void {
  if (netUnsubscribe) {
    netUnsubscribe();
    netUnsubscribe = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
  if (authUnsubscribe) {
    authUnsubscribe();
    authUnsubscribe = null;
  }
  // Limpia el timer de backoff para no dejar despertadores huérfanos tras teardown.
  useSyncStore.getState().clearWakeTimer();
  prevNet = { isConnected: null, isInternetReachable: null };
  if (__DEV__) console.log('[connectivity] Monitor stopped');
}

/** One-time check of current connectivity */
export async function checkConnectivity(): Promise<boolean> {
  const state = await NetInfo.fetch();
  prevNet = toSnapshot(state);
  const online = isOnlineFromState(state);
  useSyncStore.getState().setOnline(online);
  return online;
}
