/**
 * Network connectivity monitor.
 *
 * Uses @react-native-community/netinfo to detect online/offline.
 * Updates useSyncStore.isOnline and triggers queue processing
 * when connection is restored.
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { useSyncStore } from '../stores/useSyncStore';
import { shouldProcessOnReconnect } from './connectivitySync';

let unsubscribe: (() => void) | null = null;

export function startConnectivityMonitor(): void {
  if (unsubscribe) return; // Already listening

  unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const wasOnline = useSyncStore.getState().isOnline;
    const isNowOnline = !!(state.isConnected && state.isInternetReachable !== false);

    useSyncStore.getState().setOnline(isNowOnline);

    // Perf Fase 2E: procesar la cola SOLO en el flanco offline→online (helper
    // puro testeable). processQueue además se auto-protege contra ciclos
    // concurrentes (guard isSyncing).
    if (shouldProcessOnReconnect(wasOnline, isNowOnline)) {
      if (__DEV__) console.log('[connectivity] Back online — processing sync queue');
      useSyncStore.getState().processQueue();
    }

    if (!isNowOnline) {
      if (__DEV__) console.log('[connectivity] Went offline');
    }
  });

  if (__DEV__) console.log('[connectivity] Monitor started');
}

export function stopConnectivityMonitor(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
    if (__DEV__) console.log('[connectivity] Monitor stopped');
  }
}

/** One-time check of current connectivity */
export async function checkConnectivity(): Promise<boolean> {
  const state = await NetInfo.fetch();
  const online = !!(state.isConnected && state.isInternetReachable !== false);
  useSyncStore.getState().setOnline(online);
  return online;
}
