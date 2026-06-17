/**
 * Sync queue store V2 — offline operation management with PERSISTENCE.
 *
 * V2 CHANGES (from blueprint):
 * - Priority-based processing: P1 (business) > P2 (media) > P3 (telemetry)
 * - GPS batch processing with concurrent-5 fallback
 * - Backoff with jitter: 2s / 8s / 30s (±20%)
 * - 'dead' status after MAX_RETRIES with rollback
 * - Rollback for sale_order, unload, AND refill
 * - Structured logging (no __DEV__ guards on critical logs)
 * - Crash recovery: syncing → pending on rehydrate
 *
 * NON-NEGOTIABLE RULES ENFORCED:
 * - GPS (P3) NEVER blocks business (P1) operations
 * - Every enqueued item has an idempotency key (_operationId)
 * - Legacy ±5min dedup for sales KEPT until B.3 (server-side idempotency)
 * - Rollback never leaves stock corrupted
 */

import { create } from 'zustand';
import {
  SyncQueueItem,
  SyncItemType,
  SyncItemStatus,
  SyncPriority,
  SYNC_PRIORITY_MAP,
} from '../types/sync';
import { storeSave, storeLoad, STORAGE_KEYS } from '../persistence/storage';
import { selectPersistableQueue } from '../services/syncQueuePersistence';
import { postRest, postRpc } from '../services/api';
import {
  readPhotoAsBase64,
  deletePhoto,
  cleanupOrphanPhotos,
  PHOTO_DELETE_ON_SYNC_ENABLED,
  PHOTO_JANITOR_ENABLED,
  photoCounters,
} from '../services/camera';
import {
  checkIn,
  checkOut,
  reportIncident,
  uploadStopImage,
  createSale,
  createPayment,
  upsertLeadData,
  closeOffrouteVisit,
} from '../services/gfLogistics';
import { createGift } from '../services/gfSalesOps';
import { OffrouteVisitResultStatus } from '../services/offrouteVisit';
import { CheckoutResultStatus } from '../services/checkoutResult';
import { buildPaymentsCreatePayload, buildSalesCreatePayload } from '../services/gfLogisticsContracts';
import { areSyncDependenciesSatisfied, cascadeDeadToDependents } from '../services/syncDependencies';
import { useProductStore } from './useProductStore';
import { makeClientEventMeta } from '../utils/clientEvent';
import { pickGpsOverflowVictim, gpsBufferCounters } from '../utils/gpsBuffer';
import { logInfo, logWarn, logError } from '../utils/logger';
import { isRetryableSyncErrorMessage } from '../utils/syncFailure';
import { normalizeGpsTimestamp } from '../utils/gpsPayload';
import { syncCustomerContactUpdate } from '../services/customerContactUpdate';

// ═══ Constants ═══

const MAX_RETRIES = 3;
const MAX_ITEMS_PER_CYCLE = 200;
const GPS_BATCH_SIZE = 50;

// Backoff: 2s, 8s, 30s with ±20% jitter
const BACKOFF_SCHEDULE_MS = [2000, 8000, 30000];
const BACKOFF_JITTER = 0.2;

// Perf Fase 1B: ventana para AGRUPAR las persistencias de la cola por
// transiciones de estado (markDone/markError/markDead/clearDone/clearDead y
// post-ciclo). Antes cada mutación reescribía TODO el JSON de la cola; con un
// ciclo de 200 ítems eso eran cientos de writes. enqueue() sigue persistiendo
// INMEDIATO, así que las OPERACIONES nunca dependen del debounce — solo las
// banderas de estado, que son recuperables por idempotencia al rehidratar.
const PERSIST_DEBOUNCE_MS = 800;

let _persistTimer: ReturnType<typeof setTimeout> | null = null;
/** Agenda una persistencia (trailing): la primera mutación de la ráfaga fija
 * un write dentro de PERSIST_DEBOUNCE_MS; las siguientes se coalescen. */
function schedulePersist(): void {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    void useSyncStore.getState().persistQueue();
  }, PERSIST_DEBOUNCE_MS);
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function calculateBackoff(retryCount: number): number {
  const base = BACKOFF_SCHEDULE_MS[Math.min(retryCount, BACKOFF_SCHEDULE_MS.length - 1)];
  const jitter = base * BACKOFF_JITTER * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

// ═══ Store interface ═══

interface SyncState {
  queue: SyncQueueItem[];
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncAt: number | null;

  // Derived counts
  pendingCount: number;
  errorCount: number;
  deadCount: number;

  // V2: cycle metrics (for observability)
  lastCycleMetrics: CycleMetrics | null;

  // Actions
  enqueue: (
    type: SyncItemType,
    payload: Record<string, unknown>,
    opts?: { dependsOn?: string[] },
  ) => string;
  markDone: (id: string) => void;
  markError: (id: string, message: string) => void;
  markDead: (id: string, message: string, retries?: number) => void;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  clearDone: () => void;
  clearDead: () => number;

  // Persistence
  persistQueue: () => Promise<void>;
  rehydrateQueue: () => Promise<void>;

  // V2: Sync processor with priority
  processQueue: () => Promise<void>;

  // V2: helpers for diagnostics
  getQueueSummary: () => QueueSummary;
  countByType: (type: SyncItemType) => number;
}

interface CycleMetrics {
  cycle_start: number;
  cycle_end: number;
  cycle_duration_ms: number;
  items_processed: number;
  items_succeeded: number;
  items_failed: number;
  items_by_priority: Record<number, number>;
}

interface QueueSummary {
  total: number;
  pending: number;
  syncing: number;
  done: number;
  error: number;
  dead: number;
  by_type: Record<string, number>;
  oldest_pending_age_ms: number | null;
}

export function isUserVisibleSyncItem(item: Pick<SyncQueueItem, 'type'>): boolean {
  return item.type !== 'gps';
}

export function hasUserVisibleSyncing(queue: SyncQueueItem[]): boolean {
  return queue.some((item) => isUserVisibleSyncItem(item) && item.status === 'syncing');
}

function computeCounts(queue: SyncQueueItem[]) {
  const visibleQueue = queue.filter(isUserVisibleSyncItem);
  return {
    pendingCount: visibleQueue.filter((i) => i.status === 'pending').length,
    errorCount: visibleQueue.filter((i) => i.status === 'error').length,
    deadCount: visibleQueue.filter((i) => i.status === 'dead').length,
  };
}

// ═══ Store ═══

export const useSyncStore = create<SyncState>((set, get) => ({
  queue: [],
  isOnline: true,
  isSyncing: false,
  lastSyncAt: null,
  pendingCount: 0,
  errorCount: 0,
  deadCount: 0,
  lastCycleMetrics: null,

  // ═══ Enqueue ═══

  enqueue: (type, payload, opts) => {
    const id = uuid();
    const priority = SYNC_PRIORITY_MAP[type] ?? 3;

    const item: SyncQueueItem = {
      id,
      type,
      payload: { ...payload, _operationId: id },
      status: 'pending',
      created_at: Date.now(),
      retries: 0,
      error_message: null,
      priority,
      next_retry_at: null,
      dependsOn: opts?.dependsOn && opts.dependsOn.length > 0 ? [...opts.dependsOn] : undefined,
    };

    // GPS cap eviction (only for GPS type)
    let baseQueue = get().queue;
    if (type === 'gps') {
      try {
        const victimId = pickGpsOverflowVictim(
          baseQueue.map((i) => ({
            id: i.id,
            type: i.type,
            status: i.status,
            created_at: i.created_at,
          })),
        );
        if (victimId) {
          baseQueue = baseQueue.filter((i) => i.id !== victimId);
          logInfo('gps', 'cap_eviction', { victimId });
        }
      } catch {
        // keep baseQueue unchanged
      }
    }

    const newQueue = [...baseQueue, item];
    set({ queue: newQueue, ...computeCounts(newQueue) });

    // Persist immediately (fire-and-forget)
    get().persistQueue();

    logInfo('sync', 'enqueue', { id, type, priority });

    // BLD-008: client event metadata (async, never blocks enqueue)
    makeClientEventMeta(id)
      .then((meta) => {
        const updated = get().queue.map((i) => (i.id === id ? { ...i, meta } : i));
        set({ queue: updated });
        get().persistQueue();
      })
      .catch(() => {});

    // Auto-trigger queue processing when online (fire-and-forget).
    // Without this, enqueued items only process on connectivity change
    // or manual sync — causing sales/no-sales/checkouts to never reach Odoo.
    if (get().isOnline && !get().isSyncing) {
      setTimeout(() => get().processQueue(), 100);
    }

    return id;
  },

  // ═══ Status transitions ═══

  markDone: (id) => {
    const newQueue = get().queue.map((i) =>
      i.id === id ? { ...i, status: 'done' as SyncItemStatus } : i
    );
    set({ queue: newQueue, ...computeCounts(newQueue) });
    schedulePersist();
  },

  markError: (id, message) => {
    const item = get().queue.find((i) => i.id === id);
    if (!item) return;

    const newRetries = item.retries + 1;
    const backoffMs = calculateBackoff(newRetries - 1);

    const newQueue = get().queue.map((i) =>
      i.id === id
        ? {
            ...i,
            status: 'error' as SyncItemStatus,
            error_message: message,
            retries: newRetries,
            next_retry_at: Date.now() + backoffMs,
          }
        : i
    );
    set({ queue: newQueue, ...computeCounts(newQueue) });
    schedulePersist();

    logWarn('sync', 'item_error', {
      id, type: item.type, retries: newRetries,
      next_retry_ms: backoffMs, message,
    });
  },

  markDead: (id, message, retries) => {
    const afterParent = get().queue.map((i) =>
      i.id === id
        ? {
            ...i,
            status: 'dead' as SyncItemStatus,
            error_message: message,
            retries: retries ?? i.retries,
            next_retry_at: null,
          }
        : i
    );
    // BLD-20260617-DEAD-CASCADE: un padre muerto arrastra a sus dependientes
    // directos vivos (p.ej. la foto de la venta) a `dead`, para que no queden
    // `pending` eternos bloqueando cashclose/route-close sin escape. clearDead
    // luego los limpia junto al padre; un retry de la venta los rearma.
    const newQueue = cascadeDeadToDependents(afterParent, id);
    set({ queue: newQueue, ...computeCounts(newQueue) });
    schedulePersist();

    const cascaded = newQueue.filter(
      (i, idx) => i.status === 'dead' && afterParent[idx].status !== 'dead',
    ).length;
    logError('sync', 'item_dead', { id, message });
    if (cascaded > 0) {
      logInfo('sync', 'dead_cascade', { parent: id, dependents: cascaded });
    }
  },

  setOnline: (online) => {
    set({ isOnline: online });
    const pendingQueueCount = get().queue.filter((i) => i.status === 'pending').length;
    if (online && pendingQueueCount > 0) {
      logInfo('sync', 'reconnect_trigger', { pending: pendingQueueCount });
      get().processQueue();
    }
  },

  setSyncing: (syncing) => set({ isSyncing: syncing }),

  clearDone: () => {
    const newQueue = get().queue.filter((i) => i.status !== 'done');
    set({ queue: newQueue, ...computeCounts(newQueue) });
    schedulePersist();
  },

  // BLD-20260424-PURGE: limpieza explícita de items DEAD (operaciones que
  // agotaron sus reintentos). Útil cuando hay residuos históricos que
  // ensucian el badge rojo de SyncBar y ya nunca se van a sincronizar
  // (por ejemplo: ventas viejas con shape obsoleto, GPS sin red de hace
  // semanas, ACL errors ya resueltos pero con items huérfanos).
  //
  // Devuelve el número de items eliminados — útil para feedback al
  // operador sin necesidad de consultar el queue de vuelta.
  clearDead: () => {
    const before = get().queue.length;
    const newQueue = get().queue.filter((i) => i.status !== 'dead');
    const removed = before - newQueue.length;
    if (removed > 0) {
      set({ queue: newQueue, ...computeCounts(newQueue) });
      schedulePersist();
      logInfo('sync', 'dead_items_purged', { removed });
    }
    return removed;
  },

  // ═══ Persistence ═══

  persistQueue: async () => {
    // Un write inmediato cancela cualquier persistencia agendada (sería
    // redundante: ya escribimos el estado actual completo).
    if (_persistTimer) {
      clearTimeout(_persistTimer);
      _persistTimer = null;
    }
    const { queue } = get();
    // Only persist non-done items to avoid unbounded growth
    const toPersist = selectPersistableQueue(queue);
    await storeSave(STORAGE_KEYS.SYNC_QUEUE, toPersist);
  },

  rehydrateQueue: async () => {
    const saved = await storeLoad<SyncQueueItem[]>(STORAGE_KEYS.SYNC_QUEUE);
    if (saved && saved.length > 0) {
      const restored = saved.map((item) => ({
        ...item,
        // V2: crash recovery — syncing items reset to pending
        status: item.status === 'syncing' ? ('pending' as SyncItemStatus) : item.status,
        // V2: ensure priority exists (migration from V1 items without priority)
        priority: item.priority ?? (SYNC_PRIORITY_MAP[item.type] || 3),
        // V2: ensure next_retry_at exists
        next_retry_at: item.next_retry_at ?? null,
      }));
      set({ queue: restored, ...computeCounts(restored) });
      logInfo('sync', 'rehydrate', {
        total: restored.length,
        syncing_recovered: saved.filter((i) => i.status === 'syncing').length,
      });
    }
  },

  // ═══ V2: Priority-based Sync Processor ═══

  processQueue: async () => {
    const { queue, isOnline, isSyncing } = get();
    if (!isOnline || isSyncing) return;

    const now = Date.now();

    // Items eligible for processing:
    // - pending with no backoff, OR
    // - error with retries < MAX and backoff elapsed
    const isReady = (item: SyncQueueItem): boolean => {
      if (item.status === 'pending') return true;
      if (item.status === 'error' && item.retries < MAX_RETRIES) {
        if (item.next_retry_at && now < item.next_retry_at) return false;
        return true;
      }
      return false;
    };

    const candidates = queue.filter(isReady);
    if (candidates.length === 0) return;

    set({ isSyncing: true });
    const cycleStart = Date.now();
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    logInfo('sync', 'cycle_start', { candidates: candidates.length });

    // ── STEP 1: Separate by priority ──
    const p1 = candidates.filter((i) => i.priority === 1);
    const p2 = candidates.filter((i) => i.priority === 2);
    const p3 = candidates.filter((i) => i.priority === 3);

    // ── STEP 2: Process P1 (business) — serial, with DAG ordering ──
    const orderedP1 = computeProcessingOrder(queue, p1).slice(0, MAX_ITEMS_PER_CYCLE);
    for (const item of orderedP1) {
      const result = await processOneItem(item, get, set);
      processed++;
      if (result) succeeded++;
      else failed++;

      // If a business item fails and its retries are now >= MAX_RETRIES,
      // we don't stop the whole cycle — other independent items can proceed.
    }

    // ── STEP 3: Process P2 (media) — serial, FIFO ──
    const orderedP2 = [...p2].sort((a, b) => a.created_at - b.created_at)
      .slice(0, MAX_ITEMS_PER_CYCLE - processed);
    for (const item of orderedP2) {
      const result = await processOneItem(item, get, set);
      processed++;
      if (result) succeeded++;
      else failed++;
    }

    // ── STEP 4: Process P3 (telemetry) — GPS batched, others serial ──
    const gpsItems = p3.filter((i) => i.type === 'gps')
      .sort((a, b) => a.created_at - b.created_at);
    const otherP3 = p3.filter((i) => i.type !== 'gps')
      .sort((a, b) => a.created_at - b.created_at);

    // GPS: batch processing
    if (gpsItems.length > 0) {
      const gpsResult = await processGpsBatch(gpsItems, get, set);
      processed += gpsResult.processed;
      succeeded += gpsResult.succeeded;
      failed += gpsResult.failed;
    }

    // Other P3 (client_event etc): serial
    for (const item of otherP3.slice(0, MAX_ITEMS_PER_CYCLE - processed)) {
      const result = await processOneItem(item, get, set);
      processed++;
      if (result) succeeded++;
      else failed++;
    }

    // ── End of cycle ──
    const cycleEnd = Date.now();
    const metrics: CycleMetrics = {
      cycle_start: cycleStart,
      cycle_end: cycleEnd,
      cycle_duration_ms: cycleEnd - cycleStart,
      items_processed: processed,
      items_succeeded: succeeded,
      items_failed: failed,
      items_by_priority: {
        1: orderedP1.length,
        2: orderedP2.length,
        3: gpsItems.length + otherP3.length,
      },
    };

    set({ isSyncing: false, lastSyncAt: cycleEnd, lastCycleMetrics: metrics });
    get().persistQueue();

    logInfo('sync', 'cycle_complete', {
      duration_ms: metrics.cycle_duration_ms,
      processed,
      succeeded,
      failed,
      p1: orderedP1.length,
      p2: orderedP2.length,
      p3_gps: gpsItems.length,
      p3_other: otherP3.length,
    });

    // Photo janitor (fire-and-forget, unchanged from V1)
    if (PHOTO_JANITOR_ENABLED) {
      try {
        const referenced = new Set<string>();
        for (const i of get().queue) {
          if (i.type === 'photo' && i.status !== 'done') {
            const uri = i.payload?.localUri as string | undefined;
            if (uri) referenced.add(uri);
          }
        }
        cleanupOrphanPhotos(referenced).catch(() => {});
      } catch {}
    }
  },

  // ═══ Diagnostics helpers ═══

  getQueueSummary: (): QueueSummary => {
    const queue = get().queue;
    const byType: Record<string, number> = {};
    for (const item of queue) {
      byType[item.type] = (byType[item.type] || 0) + 1;
    }
    const pendingItems = queue.filter((i) => i.status === 'pending');
    const oldest = pendingItems.length > 0
      ? Date.now() - Math.min(...pendingItems.map((i) => i.created_at))
      : null;

    return {
      total: queue.length,
      pending: queue.filter((i) => i.status === 'pending').length,
      syncing: queue.filter((i) => i.status === 'syncing').length,
      done: queue.filter((i) => i.status === 'done').length,
      error: queue.filter((i) => i.status === 'error').length,
      dead: queue.filter((i) => i.status === 'dead').length,
      by_type: byType,
      oldest_pending_age_ms: oldest,
    };
  },

  countByType: (type) => {
    return get().queue.filter((i) => i.type === type && i.status !== 'done').length;
  },
}));

// ═══ Individual item processor ═══

async function processOneItem(
  item: SyncQueueItem,
  get: () => SyncState,
  set: (partial: Partial<SyncState> | ((state: SyncState) => Partial<SyncState>)) => void,
): Promise<boolean> {
  if (!areSyncDependenciesSatisfied(item, get().queue)) {
    logInfo('sync', 'dependency_wait', { id: item.id, type: item.type, dependsOn: item.dependsOn });
    return false;
  }

  // Mark as syncing
  const updatedQueue = get().queue.map((i) =>
    i.id === item.id ? { ...i, status: 'syncing' as SyncItemStatus } : i
  );
  set({ queue: updatedQueue });

  try {
    await processSyncItem(item);
    get().markDone(item.id);

    // Photo cleanup post-sync
    if (item.type === 'photo' && PHOTO_DELETE_ON_SYNC_ENABLED) {
      const localUri = item.payload?.localUri as string | undefined;
      if (localUri) {
        deletePhoto(localUri)
          .then(() => { photoCounters.deletedPostSyncTotal += 1; })
          .catch(() => { photoCounters.deletePostSyncErrors += 1; });
      }
    }

    return true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Sync error';
    const newRetries = item.retries + 1;
    const shouldRetry = isRetryableSyncErrorMessage(msg);

    if (!shouldRetry || newRetries >= MAX_RETRIES) {
      get().markDead(item.id, msg, newRetries);
      rollbackFailedOperation(item);
      logError('sync', 'item_dead_rollback', {
        id: item.id,
        type: item.type,
        retries: newRetries,
        error: msg,
        retryable: shouldRetry,
      });
    } else {
      get().markError(item.id, msg);
    }

    return false;
  }
}

// ═══ GPS Batch Processor ═══

async function processGpsBatch(
  items: SyncQueueItem[],
  get: () => SyncState,
  set: (partial: Partial<SyncState> | ((state: SyncState) => Partial<SyncState>)) => void,
): Promise<{ processed: number; succeeded: number; failed: number }> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  // Chunk into batches of GPS_BATCH_SIZE
  const chunks = chunkArray(items, GPS_BATCH_SIZE);

  for (const chunk of chunks) {
    // Mark all as syncing
    const ids = new Set(chunk.map((i) => i.id));
    const updatedQueue = get().queue.map((i) =>
      ids.has(i.id) ? { ...i, status: 'syncing' as SyncItemStatus } : i
    );
    set({ queue: updatedQueue });

    try {
      await tryGpsBatchCreate(chunk);
      for (const item of chunk) {
        get().markDone(item.id);
        succeeded++;
      }
      processed += chunk.length;
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'GPS sync error';
      for (const item of chunk) {
        handleGpsItemError(item, errMsg, get, set);
        failed++;
      }
      processed += chunk.length;
    }
  }

  if (processed > 0) {
    logInfo('sync', 'gps_batch_complete', { processed, succeeded, failed });
  }

  return { processed, succeeded, failed };
}

/** Try the dedicated GPS batch endpoint. Returns true if all succeeded. Throws on error. */
async function tryGpsBatchCreate(items: SyncQueueItem[]): Promise<boolean> {
  const records = items.map((i) => ({
    latitude: i.payload.latitude,
    longitude: i.payload.longitude,
    accuracy: i.payload.accuracy,
    timestamp: normalizeGpsTimestamp(i.payload.timestamp),
  }));

  await postRest('/pwa-ruta/gps-batch', {
    records,
  });

  return true;
}

function handleGpsItemError(
  item: SyncQueueItem,
  message: string,
  get: () => SyncState,
  set: (partial: Partial<SyncState> | ((state: SyncState) => Partial<SyncState>)) => void,
): void {
  const newRetries = item.retries + 1;
  if (newRetries >= MAX_RETRIES) {
    get().markDead(item.id, message);
    // GPS has no rollback — it's fire-and-forget telemetry
  } else {
    get().markError(item.id, message);
  }
}

// ═══ DAG resolver (preserved from V1 BLD-010, unchanged logic) ═══

export function computeProcessingOrder(
  fullQueue: SyncQueueItem[],
  candidates: SyncQueueItem[],
): SyncQueueItem[] {
  const anyDeps = candidates.some((c) => c.dependsOn && c.dependsOn.length > 0);
  if (!anyDeps) {
    return [...candidates].sort((a, b) => a.created_at - b.created_at);
  }

  const byId = new Map<string, SyncQueueItem>();
  for (const q of fullQueue) byId.set(q.id, q);

  const isDependencySatisfied = (depId: string): boolean => {
    const dep = byId.get(depId);
    if (!dep) return true;
    return dep.status === 'done';
  };

  const result: SyncQueueItem[] = [];
  const remaining = [...candidates];
  let guard = 0;
  const MAX_PASSES = 50;

  while (remaining.length > 0) {
    guard += 1;
    if (guard > MAX_PASSES) {
      logWarn('sync', 'dag_fallback', { reason: 'max_passes_exceeded' });
      return [...candidates].sort((a, b) => a.created_at - b.created_at);
    }

    const ready = remaining.filter((item) => {
      const deps = item.dependsOn ?? [];
      return deps.every(isDependencySatisfied);
    });

    if (ready.length === 0) break;

    ready.sort((a, b) => a.created_at - b.created_at);
    for (const item of ready) {
      result.push(item);
      byId.set(item.id, { ...item, status: 'done' });
      const idx = remaining.indexOf(item);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }

  return result;
}

// ═══ Operation dispatcher (preserved from V1, extended for V2 types) ═══

async function processSyncItem(item: SyncQueueItem): Promise<void> {
  const { type, payload } = item;
  const meta = item.meta ?? null;

  switch (type) {
    case 'sale_order':
      // Migrated to gf_logistics_ops REST endpoint. The legacy JSON-RPC
      // write required ACLs the driver user doesn't have and failed
      // noisily. The REST endpoint also tolerates obsolete stop_id
      // (treated as offroute server-side).
      await createSale(buildSalesCreatePayload(payload as Record<string, unknown>), meta);
      break;

    case 'checkin':
      await checkIn(
        payload.stop_id as number,
        payload.latitude as number,
        payload.longitude as number,
        meta,
      );
      break;

    case 'checkout':
      await checkOut(
        payload.stop_id as number,
        payload.latitude as number,
        payload.longitude as number,
        payload.result_status as CheckoutResultStatus,
        meta,
      );
      break;

    case 'no_sale':
      await reportIncident(
        payload.stop_id as number,
        (payload.reason_id as number) || 1,
        `No-venta: ${payload.reason_code || ''} ${payload.notes || ''}`.trim(),
        meta,
      );
      break;

    case 'payment':
      // Migrated to gf_logistics_ops REST endpoint. Same rationale as
      // sale_order: the legacy JSON-RPC write needed ACLs the driver
      // lacks.
      await createPayment(buildPaymentsCreatePayload(payload as Record<string, unknown>), meta);
      break;

    case 'gift':
      // El payload encolado YA es el {meta, data} de buildGiftPayload; createGift
      // lo postea a /gf/salesops/gift/create. La idempotencia la da
      // meta.idempotency_key (estable por intento) — un retry no duplica.
      await createGift(payload as Record<string, unknown>);
      break;

    case 'photo': {
      let base64 = payload.image_base64 as string;
      if (payload.localUri && !base64) {
        const fromFile = await readPhotoAsBase64(payload.localUri as string);
        if (!fromFile) throw new Error('Photo file not found');
        base64 = fromFile;
      }
      await uploadStopImage(
        payload.stop_id as number,
        base64,
        (payload.image_type as string) || 'visit',
        meta,
      );
      break;
    }

    case 'gps':
      // Individual GPS should still use the dedicated endpoint. Backend resolves
      // employee identity from the token and ignores any client employee_id.
      await postRest('/pwa-ruta/gps-batch', {
        records: [{
          latitude: payload.latitude,
          longitude: payload.longitude,
          accuracy: payload.accuracy,
          timestamp: normalizeGpsTimestamp(payload.timestamp),
        }],
      });
      break;

    case 'prospection':
      await upsertLeadData(payload as Record<string, unknown>, meta);
      break;

    case 'offroute_visit_close':
      await closeOffrouteVisit({
        visit_id: payload.visit_id,
        result_status: payload.result_status as OffrouteVisitResultStatus,
        latitude: payload.latitude,
        longitude: payload.longitude,
        notes: payload.notes,
      }, meta);
      break;

    // V2 types — basic dispatchers. Payloads follow the same
    // postRpc pattern. Backend contracts TBD per endpoint.
    case 'refill':
      await postRpc('/api/create_update', {
        model: 'van.refill.request',
        method: 'create',
        dict: payload,
      });
      break;

    case 'unload':
      await postRpc('/api/create_update', {
        model: 'van.unload',
        method: 'create',
        dict: payload,
      });
      break;

    case 'collection':
      await postRpc('/api/create_update', {
        model: 'account.payment',
        method: 'create',
        dict: {
          partner_id: payload.partner_id,
          amount: payload.amount,
          payment_type: 'inbound',
          journal_id: payload.journal_id || null,
        },
      });
      break;

    case 'transfer':
      await postRpc('/api/create_update', {
        model: 'stock.picking',
        method: 'create',
        dict: payload,
      });
      break;

    case 'customer_create':
      await postRpc('/api/create_update', {
        model: 'res.partner',
        method: 'create',
        dict: payload,
      });
      break;

    case 'customer_update':
      await syncCustomerContactUpdate(payload as Record<string, unknown>);
      break;

    default:
      logWarn('sync', 'unknown_type', { type });
  }
}

// ═══ Rollback V2 — sale_order + unload + refill ═══

function rollbackFailedOperation(item: SyncQueueItem): void {
  const updateLocalStock = useProductStore.getState().updateLocalStock;

  switch (item.type) {
    case 'sale_order': {
      // Pedido offline pendiente (política S1): NO se descuenta stock local al
      // encolar (el backend valida/descuenta al confirmar en Odoo). Por lo tanto
      // NO hay nada que restaurar si el pedido muere — restaurar aquí inflaría
      // el inventario local. El pedido muerto queda visible en Sync y bloquea
      // cierre/liquidación hasta resolverse. (Si se adoptara descuento optimista
      // —S2— habría que reactivar la restauración.)
      logError('sync', 'sale_order_dead_no_stock_rollback', {
        id: item.id,
        lines: Array.isArray(item.payload.lines) ? item.payload.lines.length : 0,
      });
      break;
    }

    case 'unload': {
      // V2: Unload deducts stock locally. On failure, restore it.
      const unloadLines = item.payload.lines as Array<{ product_id: number; qty: number }> | undefined;
      if (unloadLines && unloadLines.length > 0) {
        unloadLines.forEach((line) => {
          updateLocalStock(line.product_id, line.qty); // positive = restore
        });
        logError('sync', 'rollback_unload', {
          id: item.id,
          lines_restored: unloadLines.length,
        });
      }
      break;
    }

    case 'refill': {
      // V2: Refill ADDS stock locally. On failure, REMOVE it.
      const refillLines = item.payload.lines as Array<{ product_id: number; qty: number }> | undefined;
      if (refillLines && refillLines.length > 0) {
        refillLines.forEach((line) => {
          updateLocalStock(line.product_id, -line.qty); // negative = remove added stock
        });
        logError('sync', 'rollback_refill', {
          id: item.id,
          lines_reversed: refillLines.length,
        });
      }
      break;
    }

    // GPS, photo, client_event: no rollback needed (fire-and-forget telemetry)
    default:
      break;
  }
}

// ═══ Utility ═══

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
