/**
 * Health check system for KOLD Field V2.
 *
 * Provides a single getHealthStatus() that returns healthy/degraded/critical
 * based on sync queue state, GPS recency, and connectivity.
 *
 * Used by diagnostics export and observability UI.
 */

import { useSyncStore } from '../stores/useSyncStore';
import { useLocationStore } from '../stores/useLocationStore';
import { useProductStore } from '../stores/useProductStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getLogBuffer, getErrorLog, getPersistedErrorCount } from './logger';
import { getGpsMode } from '../services/gps';

export type HealthLevel = 'healthy' | 'degraded' | 'critical';

export interface HealthStatus {
  level: HealthLevel;
  issues: string[];
  metrics: {
    syncPending: number;
    syncErrors: number;
    syncDead: number;
    gpsAgeMinutes: number | null;
    inventorySource: string | null;
    productCount: number;
    isOnline: boolean;
    lastSync: number | null;
    recentErrors: number;
  };
}

const FIVE_MINUTES = 5 * 60_000;
const THIRTY_MINUTES = 30 * 60_000;

export function getHealthStatus(): HealthStatus {
  const issues: string[] = [];

  // Sync state
  const syncState = useSyncStore.getState();
  const pending = syncState.queue.filter((i) => i.status === 'pending').length;
  const errors = syncState.queue.filter((i) => i.status === 'error').length;
  const dead = syncState.queue.filter((i) => i.status === 'dead').length;

  // GPS state
  const locState = useLocationStore.getState();
  const gpsAgeMs = locState.lastUpdated ? Date.now() - locState.lastUpdated : null;
  const gpsAgeMinutes = gpsAgeMs !== null ? Math.round(gpsAgeMs / 60_000) : null;

  // Product state
  const prodState = useProductStore.getState();

  // Recent errors (last 5 min)
  const errorLog = getErrorLog();
  const fiveMinAgo = Date.now() - FIVE_MINUTES;
  const recentErrors = errorLog.filter(
    (e) => new Date(e.ts).getTime() > fiveMinAgo
  ).length;

  // ── Evaluate ──

  // Critical conditions
  if (dead > 0) {
    issues.push(`${dead} operacion(es) fallida(s) permanentemente`);
  }
  if (errors >= 5) {
    issues.push(`${errors} errores en cola de sync`);
  }

  // Degraded conditions
  if (errors > 0 && errors < 5) {
    issues.push(`${errors} error(es) en cola`);
  }
  if (pending > 20) {
    issues.push(`${pending} operaciones pendientes`);
  }
  if (!syncState.isOnline) {
    issues.push('Sin conexion');
  }
  if (gpsAgeMinutes !== null && gpsAgeMinutes > 30) {
    issues.push(`GPS sin actualizar (${gpsAgeMinutes} min)`);
  }
  if (recentErrors >= 10) {
    issues.push(`${recentErrors} errores en ultimos 5 min`);
  }

  // Determine level
  let level: HealthLevel = 'healthy';
  if (dead > 0 || errors >= 5 || recentErrors >= 10) {
    level = 'critical';
  } else if (issues.length > 0) {
    level = 'degraded';
  }

  return {
    level,
    issues,
    metrics: {
      syncPending: pending,
      syncErrors: errors,
      syncDead: dead,
      gpsAgeMinutes,
      inventorySource: prodState.inventorySource,
      productCount: prodState.productCount,
      isOnline: syncState.isOnline,
      lastSync: prodState.lastSync,
      recentErrors,
    },
  };
}

// ── Lightweight snapshot for quick access ──

export interface LocalHealthSnapshot {
  status: HealthLevel;
  pendingCount: number;
  deadCount: number;
  lastSyncAt: number | null;
  gpsQueueSize: number;
  gpsMode: string;
  inventorySource: 'truck' | 'quant' | 'global' | 'none';
}

/**
 * Fast, lightweight health snapshot.
 * No heavy computation — safe to call from UI or monitoring.
 */
export function getLocalHealthSnapshot(): LocalHealthSnapshot {
  const health = getHealthStatus();
  const sync = useSyncStore.getState();
  const prod = useProductStore.getState();
  const gpsQueueSize = sync.queue.filter((i) => i.type === 'gps' && i.status === 'pending').length;

  const sourceMap: Record<string, 'truck' | 'quant' | 'global'> = {
    truck_stock: 'truck',
    stock_quant: 'quant',
    global_legacy: 'global',
  };

  return {
    status: health.level,
    pendingCount: health.metrics.syncPending,
    deadCount: health.metrics.syncDead,
    lastSyncAt: sync.lastSyncAt,
    gpsQueueSize,
    gpsMode: getGpsMode(),
    inventorySource: prod.inventorySource
      ? (sourceMap[prod.inventorySource] || 'global')
      : 'none',
  };
}

/**
 * Generate full diagnostics export for support/debugging.
 * Returns a JSON-serializable object with all system state.
 */
export function getDiagnosticsExport(): Record<string, unknown> {
  const auth = useAuthStore.getState();
  const sync = useSyncStore.getState();
  const products = useProductStore.getState();
  const location = useLocationStore.getState();
  const health = getHealthStatus();
  const logBuffer = getLogBuffer();
  const apiLogs = logBuffer.filter((entry) => entry.category === 'api');

  return {
    exportedAt: new Date().toISOString(),
    appVersion: 'kold-field-v2',
    health: {
      level: health.level,
      issues: health.issues,
      metrics: health.metrics,
    },
    auth: {
      employeeId: auth.employeeId,
      employeeName: auth.employeeName,
      isAuthenticated: auth.isAuthenticated,
      warehouseId: auth.warehouseId,
      // Never export password/session tokens
    },
    sync: {
      isOnline: sync.isOnline,
      isSyncing: sync.isSyncing,
      pendingCount: sync.pendingCount,
      errorCount: sync.errorCount,
      queueSize: sync.queue.length,
      queueByStatus: {
        pending: sync.queue.filter((i) => i.status === 'pending').length,
        syncing: sync.queue.filter((i) => i.status === 'syncing').length,
        done: sync.queue.filter((i) => i.status === 'done').length,
        error: sync.queue.filter((i) => i.status === 'error').length,
        dead: sync.queue.filter((i) => i.status === 'dead').length,
      },
      // Include error items for debugging
      errorItems: sync.queue
        .filter((i) => i.status === 'error' || i.status === 'dead')
        .map((i) => ({
          id: i.id,
          type: i.type,
          status: i.status,
          retries: i.retries,
          error: i.error_message,
          created: i.created_at,
        })),
    },
    inventory: {
      source: products.inventorySource,
      productCount: products.productCount,
      totalStockKg: products.totalStockKg,
      lastSync: products.lastSync,
    },
    location: {
      status: location.status,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      lastUpdate: location.lastUpdated,
    },
    gps: {
      mode: getGpsMode(),
      queueSize: sync.queue.filter((i) => i.type === 'gps' && i.status === 'pending').length,
    },
    logs: {
      recentCount: logBuffer.length,
      errorCount: getErrorLog().length,
      persistedErrorCount: getPersistedErrorCount(),
      last20: logBuffer.slice(-20),
      apiLast50: apiLogs.slice(-50),
      errors: getErrorLog().slice(-50), // Full persisted set (up to 50)
    },
  };
}
