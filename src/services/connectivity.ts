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
import { shouldWakeOnNetTransition, NetSnapshot } from './syncWakeup';
import { createLegacyRefreshRunner } from './legacyRefreshRunner';
import { logWarn } from '../utils/logger';

let netUnsubscribe: (() => void) | null = null;
let appStateSubscription: { remove: () => void } | null = null;

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
 * se limpia (`markLegacyRefreshCompleted`) DESPUÉS de un `loadProducts` exitoso.
 * `loadProducts` del store TRAGA sus errores (setea `error` y resuelve), así que
 * aquí derivamos el éxito del estado `error` posterior y lanzamos si falló, para
 * que el runner conserve el pending y reintente en la próxima reconexión.
 * El guard in-flight (dentro del runner) evita dos refresh simultáneos si los
 * eventos de red y foreground caen juntos.
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
