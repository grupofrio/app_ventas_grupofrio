/**
 * Sync queue store V2 — offline operation management with PERSISTENCE.
 *
 * V2 CHANGES (from blueprint):
 * - Priority-based processing: P1 (business) > P2 (media) > P3 (telemetry)
 * - GPS batch processing with concurrent-5 fallback
 * - Backoff with jitter: 2s / 8s / 30s (±20%)
 * - 'dead' status after MAX_RETRIES with rollback
 * - Rollback GENÉRICO por `_localStockDelta` (independiente del type)
 * - Migración/guard de eventos legacy refill/unload (retirados del producto):
 *   nunca se reenvían; se revierte el stock local y se descartan de la cola.
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
  SyncEnqueueOptions,
  SyncItemType,
  SyncItemStatus,
  SyncPriority,
  SYNC_PRIORITY_MAP,
} from '../types/sync';
import { storeLoad, storeSaveStrict, STORAGE_KEYS } from '../persistence/storage';
import { selectPersistableQueue } from '../services/syncQueuePersistence';
import { createSerializedPersistenceCoordinator } from '../services/serializedTaskRunner';
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
import { shouldRetrySyncItemError } from '../services/syncRetryDecision';
import { normalizeGpsTimestamp } from '../utils/gpsPayload';
import { syncCustomerContactUpdate } from '../services/customerContactUpdate';
import { computeLocalStockReversal } from '../services/stockRollback';
import {
  isLegacyRefillUnloadItem,
  planLegacyReversal,
  partitionLegacyRefillUnload,
  consumedFlagForSource,
  runDurableLegacyMigration,
  handleDurableMigrationResult,
} from '../services/legacyRefillUnloadMigration';
import { nextWakeDelayMs, decidePostCycleActionAfterCycle } from '../services/syncWakeup';
import { applySyncEnqueue } from '../services/syncEnqueue';
import {
  createSyncCycleMetrics,
  createSyncProcessingHolds,
  runUnlessProcessingHeld,
  runUnheldProcessingChunk,
} from '../services/syncProcessingHolds';
import {
  applySaleTerminalMarkerDeferral,
  isSaleTerminalMarkerPersistenceError,
  processSyncItemToCompletion,
} from '../services/syncItemCompletion';
import { useVisitStore } from './useVisitStore';

// ═══ Constants ═══

const MAX_RETRIES = 3;
const MAX_ITEMS_PER_CYCLE = 200;
const GPS_BATCH_SIZE = 50;

// Backoff: 2s, 8s, 30s with ±20% jitter
const BACKOFF_SCHEDULE_MS = [2000, 8000, 30000];
const BACKOFF_JITTER = 0.2;

// Backoff de un ítem legacy DIFERIDO por fallo de persistencia final. Fijo (no
// escalante) y != 0ms: reintenta con cadencia moderada sin redrenaje agresivo.
const LEGACY_DEFER_BACKOFF_MS = 8000;

// Perf Fase 1B: ventana para AGRUPAR las persistencias de la cola por
// transiciones de estado (markDone/markError/markDead/clearDone/clearDead y
// post-ciclo). Antes cada mutación reescribía TODO el JSON de la cola; con un
// ciclo de 200 ítems eso eran cientos de writes. enqueue() sigue persistiendo
// INMEDIATO, así que las OPERACIONES nunca dependen del debounce — solo las
// banderas de estado, que son recuperables por idempotencia al rehidratar.
const PERSIST_DEBOUNCE_MS = 800;

const queuePersistence = createSerializedPersistenceCoordinator<SyncQueueItem[], SyncQueueItem[]>({
  read: () => useSyncStore.getState().queue,
  select: selectPersistableQueue,
  write: (snapshot) => storeSaveStrict(STORAGE_KEYS.SYNC_QUEUE, snapshot),
  publish: (queue) => {
    useSyncStore.setState({ queue, ...computeCounts(queue) });
  },
});

function persistCurrentQueue(): Promise<void> {
  return queuePersistence.persistCurrent();
}

function persistQueueInBackground(source: string): void {
  void useSyncStore.getState().persistQueue().catch((error: unknown) => {
    logError('sync', 'sync_queue_persist_failed', {
      source,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null;
/** Agenda una persistencia (trailing): la primera mutación de la ráfaga fija
 * un write dentro de PERSIST_DEBOUNCE_MS; las siguientes se coalescen. */
function schedulePersist(): void {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    persistQueueInBackground('scheduled_writer');
  }, PERSIST_DEBOUNCE_MS);
}

// PR-1 — Despertador de backoff. Un ÚNICO timer que dispara processQueue cuando
// vence el next_retry_at del ítem-en-error más próximo. Sin esto, un ítem que
// falló por red (status='error') calculaba su next_retry_at pero nadie volvía a
// invocar processQueue: quedaba esperando indefinidamente a un enqueue nuevo o a
// un flanco de reconexión. El timer NO es un segundo procesador: solo invoca el
// processQueue existente, que se auto-protege con el guard isSyncing.
let _wakeTimer: ReturnType<typeof setTimeout> | null = null;

const processingHolds = createSyncProcessingHolds();

// P2 (Codex): "waker" INYECTADO del refresh autoritativo. connectivity registra
// aquí `requestLegacyAuthoritativeRefresh` (runner singleton). Se invoca DESPUÉS
// de que una migración deja `legacyRefreshPending=true` durable + en memoria, para
// cerrar la carrera runner-preventivo/dispatcher. Inyección (no import) para NO
// crear ciclo useSyncStore↔connectivity. Runtime-safe si aún no hay waker (no-op).
let _legacyRefreshWaker: (() => void) | null = null;
function notifyRefreshPendingReady(): void {
  try {
    _legacyRefreshWaker?.();
  } catch {
    // el wake nunca debe romper la migración
  }
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

  // Migración legacy refill/unload: cuántas solicitudes antiguas se descartaron
  // (para el aviso NO bloqueante) y si hay que forzar un refresh autoritativo de
  // inventario al reconectar (el delta local revertido lo confirma el servidor).
  legacyMigrationNoticeCount: number;
  legacyRefreshPending: boolean;

  // V2: cycle metrics (for observability)
  lastCycleMetrics: CycleMetrics | null;

  // Actions
  enqueue: (
    type: SyncItemType,
    payload: Record<string, unknown>,
    opts?: SyncEnqueueOptions,
  ) => string;
  releaseProcessingHolds: (ids: string[]) => void;
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

  // PR-1: backoff wake timer (arms a single timer for the soonest retryable
  // error item; fires processQueue when its backoff elapses).
  scheduleWake: () => void;
  clearWakeTimer: () => void;

  // Migración/guard de eventos legacy refill/unload. Async: la reparación
  // pendiente se persiste durablemente ANTES de retirar cola o tocar stock.
  migrateLegacyRefillUnload: () => Promise<{ migrated: number; reverted: number; ok: boolean }>;
  discardLegacyRefillUnload: (
    id: string,
  ) => Promise<{ status: 'completed' | 'deferred' | 'not_legacy' }>;
  // P2: connectivity inyecta aquí el disparador del refresh autoritativo (runner
  // singleton). Toda migración que deje pending durable lo invoca al terminar.
  setLegacyRefreshWaker: (waker: (() => void) | null) => void;
  clearLegacyMigrationNotice: () => void;
  // Refresh autoritativo: `has` LEE (no consume); `markCompleted` limpia SOLO
  // tras un refresh exitoso, de forma DURABLE (persiste false y espera confirmación
  // antes de tocar memoria; rechaza si la limpieza durable falla → retry seguro).
  hasLegacyRefreshPending: () => boolean;
  markLegacyRefreshCompleted: () => Promise<void>;

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
  legacyMigrationNoticeCount: 0,
  legacyRefreshPending: false,
  lastCycleMetrics: null,

  // ═══ Enqueue ═══

  enqueue: (type, payload, opts) => {
    const generatedId = uuid();
    const createdAt = Date.now();
    const originalQueue = get().queue;
    let result = applySyncEnqueue({
      queue: originalQueue,
      type,
      payload,
      options: opts,
      generatedId,
      createdAt,
    });

    // Idempotency is resolved first: GPS-cap eviction is only valid for a real
    // insertion, never for reuse/rearm/collision of an explicit operation id.
    if (result.action === 'inserted' && type === 'gps') {
      try {
        const victimId = pickGpsOverflowVictim(
          originalQueue.map((i) => ({
            id: i.id,
            type: i.type,
            status: i.status,
            created_at: i.created_at,
          })),
        );
        if (victimId) {
          const baseQueue = originalQueue.filter((i) => i.id !== victimId);
          logInfo('gps', 'cap_eviction', { victimId });
          result = applySyncEnqueue({
            queue: baseQueue,
            type,
            payload,
            options: opts,
            generatedId,
            createdAt,
          });
        }
      } catch {
        // Keep the original insertion result unchanged.
      }
    }

    if (opts?.holdProcessing) {
      processingHolds.hold([result.id]);
    }

    if (result.action !== 'reused') {
      set({ queue: result.queue, ...computeCounts(result.queue) });

      // Persist every queue mutation immediately (fire-and-forget).
      persistQueueInBackground('enqueue');
      const priority = SYNC_PRIORITY_MAP[type] ?? 3;
      logInfo('sync', 'enqueue', { id: result.id, type, priority, action: result.action });
    }

    if (result.action === 'inserted') {
      // BLD-008: client event metadata (async, never blocks enqueue)
      makeClientEventMeta(result.id)
        .then((meta) => {
          const updated = get().queue.map((i) => (i.id === result.id ? { ...i, meta } : i));
          set({ queue: updated });
          persistQueueInBackground('metadata_completion');
        })
        .catch(() => {});
    }

    // Auto-trigger queue processing when online (fire-and-forget).
    // Without this, enqueued items only process on connectivity change
    // or manual sync — causing sales/no-sales/checkouts to never reach Odoo.
    if (!opts?.holdProcessing && get().isOnline && !get().isSyncing) {
      setTimeout(() => get().processQueue(), 100);
    }

    return result.id;
  },

  releaseProcessingHolds: (ids) => {
    processingHolds.release(ids);
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

  persistQueue: () => {
    // Un write inmediato cancela cualquier persistencia agendada (sería
    // redundante: ya escribimos el estado actual completo).
    if (_persistTimer) {
      clearTimeout(_persistTimer);
      _persistTimer = null;
    }
    return persistCurrentQueue();
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
      // Arma el despertador de backoff para ítems en error rehidratados, que de
      // otro modo esperarían a un enqueue o a un flanco de reconexión.
      get().scheduleWake();
    }
    // Rehidrata la bandera DURABLE de refresh autoritativo pendiente: si una
    // migración previa retiró eventos legacy pero la app cerró (o el refresh
    // falló) antes de recargar inventario, el pending sobrevive y se reintenta
    // en la próxima reconexión/foreground.
    const refreshPending = await storeLoad<boolean>(STORAGE_KEYS.LEGACY_REFRESH_PENDING);
    if (refreshPending === true) {
      set({ legacyRefreshPending: true });
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

    const candidates = processingHolds.withoutHeld(queue).filter(isReady);
    if (candidates.length === 0) {
      // Nada listo AHORA, pero puede haber ítems en error con backoff futuro:
      // arma el despertador para cuando venza el más próximo.
      get().scheduleWake();
      return;
    }

    set({ isSyncing: true });
    const cycleStart = Date.now();
    const cycleTally = createSyncCycleMetrics();
    let gpsDispatched = 0;
    // P1 (Codex): un ítem DIFERIDO por fallo de persistencia local NO debe
    // disparar drain_now (redrenaje agresivo si el storage sigue fallando). Se
    // rastrea aquí y se usa en la decisión post-ciclo para forzar backoff.
    let hadDeferredStorageFailure = false;
    const tally = (item: SyncQueueItem, outcome: ProcessItemOutcome): void => {
      if (outcome === 'deferred') hadDeferredStorageFailure = true;
      cycleTally.recordOutcome(item.priority, outcome);
    };

    logInfo('sync', 'cycle_start', { candidates: candidates.length });

    // P2 (Codex): todo el cuerpo del ciclo va en try/finally. processOneItem y
    // processGpsBatch ya capturan sus propios errores, pero un throw inesperado
    // FUERA de ellos (p.ej. en el ordenamiento/DAG o en un helper) no debe dejar
    // isSyncing colgado en true — eso neutralizaría TODOS los despertadores
    // futuros por el guard `if (!isOnline || isSyncing) return`.
    let hadUnhandledCycleError = false;
    try {
      // ── STEP 1: Separate by priority ──
      const p1 = candidates.filter((i) => i.priority === 1);
      const p2 = candidates.filter((i) => i.priority === 2);
      const p3 = candidates.filter((i) => i.priority === 3);

      // ── STEP 2: Process P1 (business) — serial, with DAG ordering ──
      const orderedP1 = computeProcessingOrder(queue, p1).slice(0, MAX_ITEMS_PER_CYCLE);
      for (const item of orderedP1) {
        tally(item, await processOneItem(item, get, set));
        // If a business item fails and its retries are now >= MAX_RETRIES,
        // we don't stop the whole cycle — other independent items can proceed.
      }

      // ── STEP 3: Process P2 (media) — serial, FIFO ──
      const orderedP2 = [...p2].sort((a, b) => a.created_at - b.created_at)
        .slice(0, MAX_ITEMS_PER_CYCLE - cycleTally.snapshot().processed);
      for (const item of orderedP2) {
        tally(item, await processOneItem(item, get, set));
      }

      // ── STEP 4: Process P3 (telemetry) — GPS batched, others serial ──
      const gpsItems = p3.filter((i) => i.type === 'gps')
        .sort((a, b) => a.created_at - b.created_at);
      const otherP3 = p3.filter((i) => i.type !== 'gps')
        .sort((a, b) => a.created_at - b.created_at);

      // GPS: batch processing
      if (gpsItems.length > 0) {
        const gpsResult = await processGpsBatch(gpsItems, get, set);
        cycleTally.recordBatch(3, gpsResult);
        gpsDispatched += gpsResult.processed;
      }

      // Other P3 (client_event etc): serial
      for (const item of otherP3.slice(
        0,
        MAX_ITEMS_PER_CYCLE - cycleTally.snapshot().processed,
      )) {
        tally(item, await processOneItem(item, get, set));
      }

      // ── End of cycle ──
      const cycleEnd = Date.now();
      const cycleCounts = cycleTally.snapshot();
      const metrics: CycleMetrics = {
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
        cycle_duration_ms: cycleEnd - cycleStart,
        items_processed: cycleCounts.processed,
        items_succeeded: cycleCounts.succeeded,
        items_failed: cycleCounts.failed,
        items_by_priority: cycleCounts.itemsByPriority,
      };
      set({ lastSyncAt: cycleEnd, lastCycleMetrics: metrics });

      logInfo('sync', 'cycle_complete', {
        duration_ms: metrics.cycle_duration_ms,
        processed: cycleCounts.processed,
        succeeded: cycleCounts.succeeded,
        failed: cycleCounts.failed,
        p1: cycleCounts.itemsByPriority[1],
        p2: cycleCounts.itemsByPriority[2],
        p3_gps: gpsDispatched,
        p3_other: cycleCounts.itemsByPriority[3] - gpsDispatched,
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
    } catch (err: unknown) {
      hadUnhandledCycleError = true;
      const message = err instanceof Error ? err.message : 'unhandled sync cycle error';
      logError('sync', 'cycle_unhandled_error', { message });
    } finally {
      // Garantías pase lo que pase: liberar el mutex isSyncing y persistir la cola.
      set({ isSyncing: false });
      persistQueueInBackground('process_finally');

      // P2 (Codex): decidir el siguiente paso con la MISMA lógica de dependencias
      // que processQueue. Si quedó trabajo elegible con deps satisfechas — p.ej.
      // un `pending` encolado DURANTE el ciclo, cuyo setTimeout de enqueue cayó
      // mientras isSyncing=true y regresó por guard — re-drenamos en el próximo
      // tick. Si solo quedan errores en backoff, armamos el timer.
      //
      // P1+P2 (Codex): tras un throw INESPERADO (hadUnhandledCycleError) la
      // política es IDLE DURO. Ni drain_now (setTimeout(0) → re-entra → re-lanza
      // → loop instantáneo, P1) ni scheduleWake (si hay un `error` con backoff
      // ya vencido y el throw ocurre ANTES de procesarlo, sus retries nunca
      // avanzan hacia dead y el timer re-armaría un loop sostenido de ~250 ms,
      // P2). decidePostCycleActionAfterCycle devuelve siempre 'idle' en ese
      // caso; aquí además limpiamos cualquier wake timer pendiente. La cola
      // queda a la espera de un evento EXTERNO: foreground, reconexión, enqueue
      // nuevo o reintento manual — con el error ya logueado para diagnóstico.
      // P1 (Codex, ronda final): si hubo un ítem DIFERIDO por fallo de
      // persistencia local, NUNCA drain_now — usar backoff. Sin esto, el ítem
      // seguía en cola y (si quedaba elegible) re-disparaba drain_now → storage
      // falla → drain_now, en bucle. El ítem diferido queda en 'error'+backoff
      // (fuera de la elegibilidad inmediata), y scheduleWake lo reintenta al vencer.
      const action = decidePostCycleActionAfterCycle({
        hadUnhandledCycleError,
        hadDeferredStorageFailure,
        queue: processingHolds.withoutHeld(get().queue),
        now: Date.now(),
        maxRetries: MAX_RETRIES,
        depsSatisfied: areSyncDependenciesSatisfied,
      });
      if (hadUnhandledCycleError) {
        get().clearWakeTimer();
        logWarn('sync', 'post_cycle_redrain_skipped_after_error', { next: 'idle' });
      } else if (action === 'drain_now') {
        setTimeout(() => { void get().processQueue(); }, 0);
      } else {
        if (hadDeferredStorageFailure) {
          logWarn('sync', 'post_cycle_backoff_after_deferred_storage', { next: 'schedule_wake' });
        }
        get().scheduleWake();
      }
    }
  },

  // ═══ PR-1: Backoff wake timer ═══

  scheduleWake: () => {
    // Siempre reemplaza el timer vigente (idempotente): recalcula el ítem-en-
    // error más próximo con el estado actual de la cola.
    if (_wakeTimer) {
      clearTimeout(_wakeTimer);
      _wakeTimer = null;
    }
    const { queue, isOnline } = get();
    // Offline: no tiene sentido agendar; el flanco de reconexión re-arma.
    if (!isOnline) return;
    const delay = nextWakeDelayMs(processingHolds.withoutHeld(queue), {
      maxRetries: MAX_RETRIES,
      now: Date.now(),
    });
    if (delay == null) return;
    _wakeTimer = setTimeout(() => {
      _wakeTimer = null;
      // Solo dispara el processQueue existente (guard isSyncing evita ciclos
      // concurrentes). El re-armado lo hace el propio processQueue al terminar.
      void get().processQueue();
    }, delay);
  },

  clearWakeTimer: () => {
    if (_wakeTimer) {
      clearTimeout(_wakeTimer);
      _wakeTimer = null;
    }
  },

  // ═══ Migración/guard de eventos legacy refill/unload ═══

  // Migra TODA la cola: revierte el stock local de los eventos legacy de
  // recarga/devolución y los retira. Idempotente y seguro ante cierre a mitad:
  //   Fase 1 — MARCA el consumo (`_localStockRolledBack`/`_legacyStockRestored`)
  //            y persiste ANTES de tocar stock, para que una reejecución tras un
  //            cierre a mitad NUNCA vuelva a revertir (a lo sumo pierde una
  //            reversión, que el refresh autoritativo corrige).
  //   Fase 2 — aplica la reversión al stock local.
  //   Fase 3 — retira los legacy de la cola, arma el aviso y el refresh pendiente.
  migrateLegacyRefillUnload: async () => {
    const { legacy } = partitionLegacyRefillUnload(get().queue);
    if (legacy.length === 0) return { migrated: 0, reverted: 0, ok: true };
    return durableMigrateLegacy(get, set, legacy);
  },

  // Descarta UN ítem legacy (guard del dispatcher). MISMA operación durable que
  // la migración (un solo helper). status='deferred' si la persistencia crítica
  // falló → el guard NO lo marca procesado y lo difiere con backoff.
  discardLegacyRefillUnload: async (id) => {
    const item = get().queue.find((i) => i.id === id);
    if (!item || !isLegacyRefillUnloadItem(item)) return { status: 'not_legacy' };
    const res = await durableMigrateLegacy(get, set, [item]);
    return { status: res.status };
  },

  setLegacyRefreshWaker: (waker) => {
    _legacyRefreshWaker = waker;
  },

  clearLegacyMigrationNotice: () => set({ legacyMigrationNoticeCount: 0 }),

  // LEE (no consume) si hay refresh autoritativo pendiente.
  hasLegacyRefreshPending: () => get().legacyRefreshPending,

  // Limpieza DURABLE verificable: persiste false y ESPERA confirmación; solo
  // entonces toca memoria. Si la limpieza durable falla, PROPAGA (memoria sigue
  // pending=true) → el runner devuelve completion_persist_failed y reintenta.
  markLegacyRefreshCompleted: async () => {
    await storeSaveStrict(STORAGE_KEYS.LEGACY_REFRESH_PENDING, false);
    set({ legacyRefreshPending: false });
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

// ═══ Migración DURABLE compartida (rehidratado + guard del dispatcher) ═══
//
// Orden seguro (ver runDurableLegacyMigration): pending durable → marcar+persistir
// → revertir stock → retirar+persistir. Captura las reversiones ANTES de marcar
// consumido para que sean idempotentes. Un único helper para no duplicar lógica.
async function durableMigrateLegacy(
  get: () => SyncState,
  set: (partial: Partial<SyncState> | ((state: SyncState) => Partial<SyncState>)) => void,
  events: SyncQueueItem[],
): Promise<{ migrated: number; reverted: number; ok: boolean; status: 'completed' | 'deferred' }> {
  const ids = new Set(events.map((e) => e.id));
  const reversalEntries: Array<{ product_id: number; qty: number }> = [];
  const consumedFlagById = new Map<string, '_localStockRolledBack' | '_legacyStockRestored' | null>();
  for (const ev of events) {
    const plan = planLegacyReversal(ev);
    consumedFlagById.set(ev.id, plan ? consumedFlagForSource(plan.source) : null);
    if (plan) for (const r of plan.reversal) reversalEntries.push(r);
  }

  const result = await runDurableLegacyMigration({
    // 1. pending durable ANTES de tocar cola/stock.
    persistPendingTrue: async () => {
      await storeSaveStrict(STORAGE_KEYS.LEGACY_REFRESH_PENDING, true);
      set({ legacyRefreshPending: true });
    },
    // 2. marcar consumido + persistir la cola (memoria solo tras persistir).
    markConsumedAndPersist: () => {
      return queuePersistence.transformAndPersist((queue) =>
        queue.map((i) => {
          const flag = ids.has(i.id) ? consumedFlagById.get(i.id) : null;
          return flag ? { ...i, payload: { ...i.payload, [flag]: true } } : i;
        }),
      );
    },
    // 3. reversión local (idempotente: flags de consumo ya durables).
    applyReversal: () => {
      const updateLocalStock = useProductStore.getState().updateLocalStock;
      for (const r of reversalEntries) updateLocalStock(r.product_id, r.qty);
    },
    // 4. retirar de la cola + persistir + aviso (memoria solo tras persistir).
    removeAndPersist: async () => {
      await queuePersistence.transformAndPersist((queue) =>
        queue.filter((i) => !ids.has(i.id)),
      );
      set({ legacyMigrationNoticeCount: get().legacyMigrationNoticeCount + events.length });
    },
    onPhaseError: (phase, error) =>
      logWarn('sync', 'legacy_migration_phase_failed', {
        phase,
        message: error instanceof Error ? error.message : String(error),
      }),
  });

  const ok = result.ok;
  // Handler ÚNICO del resultado (P2): difiere TODO el lote con backoff si quedó
  // deferred (también en rehydrate, no solo en el dispatcher) y despierta el runner
  // tras dejar pending durable. Sin duplicar la lógica de defer/wake.
  const status = handleDurableMigrationResult(result, {
    defer: () => deferLegacyEvents(get, set, [...ids]),
    notifyRefreshPending: notifyRefreshPendingReady,
  });
  logWarn('sync', 'legacy_refill_unload_migrated', {
    migrated: ok ? events.length : 0,
    reverted: ok ? reversalEntries.length : 0,
    phase: result.phase,
    ok,
    status,
  });
  return {
    migrated: ok ? events.length : 0,
    reverted: ok ? reversalEntries.length : 0,
    ok,
    status,
  };
}

// Difiere un LOTE de ítems legacy con backoff SIN mandarlos a dead: status='error',
// retries=0 (nunca alcanza MAX_RETRIES), next_retry_at futuro (fuera de la
// elegibilidad inmediata → no drain_now). El reintento re-ejecuta la operación
// durable; el stock NO se re-revierte (flag de consumo ya durable). Único punto de
// defer, compartido por rehydrate y dispatcher (vía durableMigrateLegacy).
function deferLegacyEvents(
  get: () => SyncState,
  set: (partial: Partial<SyncState> | ((state: SyncState) => Partial<SyncState>)) => void,
  ids: string[],
): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const retryAt = Date.now() + LEGACY_DEFER_BACKOFF_MS;
  const newQueue = get().queue.map((i) =>
    idSet.has(i.id)
      ? {
          ...i,
          status: 'error' as SyncItemStatus,
          error_message: 'legacy migration deferred (storage)',
          retries: 0, // NO acumula → nunca dead; el guard intercepta antes de enviar
          next_retry_at: retryAt,
        }
      : i,
  );
  set({ queue: newQueue, ...computeCounts(newQueue) });
  schedulePersist();
  // Arma el despertador de backoff AHORA: en rehydrate el defer ocurre fuera de un
  // ciclo de processQueue (no hay decisión post-ciclo que lo agende), así que sin
  // esto el reintento esperaría a un evento externo. Idempotente en el dispatcher.
  get().scheduleWake();
}

// ═══ Individual item processor ═══

// Resultado explícito del procesador de un ítem (P1 Codex):
//  - 'handled'         → completado (o descartado con reparación durable); cuenta éxito.
//  - 'failed'          → error real (markError/markDead); cuenta fallo.
//  - 'deferred'        → persistencia local pendiente: migración legacy aún no
//                        completada, o venta ya procesada remotamente cuyo terminal
//                        marker local sigue pendiente. No cuenta como handled/failed
//                        ni debe disparar drain_now; permanece en cola con backoff.
//  - 'dependency_wait' → esperando una dependencia; no es fallo real.
type ProcessItemOutcome = 'handled' | 'failed' | 'deferred' | 'dependency_wait';

async function processOneItem(
  item: SyncQueueItem,
  get: () => SyncState,
  set: (partial: Partial<SyncState> | ((state: SyncState) => Partial<SyncState>)) => void,
): Promise<ProcessItemOutcome> {
  return runUnlessProcessingHeld({
    registry: processingHolds,
    id: item.id,
    heldResult: 'dependency_wait' as ProcessItemOutcome,
    onHeld: () => logInfo('sync', 'processing_hold_wait', { id: item.id, type: item.type }),
    run: () => processOneItemUnheld(item, get, set),
  });
}

async function processOneItemUnheld(
  item: SyncQueueItem,
  get: () => SyncState,
  set: (partial: Partial<SyncState> | ((state: SyncState) => Partial<SyncState>)) => void,
): Promise<ProcessItemOutcome> {
  // Guard temporal (compat una versión): un evento legacy de recarga/devolución
  // que haya quedado en la cola NUNCA se envía a ningún endpoint. Se migra con la
  // MISMA operación durable que el rehidratado.
  if (isLegacyRefillUnloadItem(item)) {
    // discardLegacyRefillUnload → durableMigrateLegacy YA difiere con backoff y
    // despierta el runner (handler único). Aquí solo mapeamos el status al
    // resultado del ciclo: 'deferred' evita el drain_now agresivo.
    const res = await get().discardLegacyRefillUnload(item.id);
    if (res.status === 'deferred') {
      logWarn('sync', 'legacy_dispatch_guard_deferred', { id: item.id, type: item.type });
      return 'deferred';
    }
    logWarn('sync', 'legacy_dispatch_guard', { id: item.id, type: item.type, status: res.status });
    return 'handled'; // completed o not_legacy: nada más que hacer
  }

  if (!areSyncDependenciesSatisfied(item, get().queue)) {
    logInfo('sync', 'dependency_wait', { id: item.id, type: item.type, dependsOn: item.dependsOn });
    return 'dependency_wait';
  }

  // Mark as syncing
  const updatedQueue = get().queue.map((i) =>
    i.id === item.id ? { ...i, status: 'syncing' as SyncItemStatus } : i
  );
  set({ queue: updatedQueue });

  try {
    await processSyncItemToCompletion({
      item,
      process: processSyncItem,
      markSaleReadyToContinue: (operationId) =>
        useVisitStore.getState().markSaleReadyToContinue(operationId),
      markDone: (id) => get().markDone(id),
    });

    // Photo cleanup post-sync
    if (item.type === 'photo' && PHOTO_DELETE_ON_SYNC_ENABLED) {
      const localUri = item.payload?.localUri as string | undefined;
      if (localUri) {
        deletePhoto(localUri)
          .then(() => { photoCounters.deletedPostSyncTotal += 1; })
          .catch(() => { photoCounters.deletePostSyncErrors += 1; });
      }
    }

    return 'handled';
  } catch (error: unknown) {
    if (isSaleTerminalMarkerPersistenceError(error)) {
      const backoffMs = calculateBackoff(0);
      const retryAt = Date.now() + backoffMs;
      const newQueue = applySaleTerminalMarkerDeferral(
        get().queue,
        error.operationId,
        retryAt,
      );
      set({ queue: newQueue, ...computeCounts(newQueue) });
      schedulePersist();
      logWarn('sync', 'sale_terminal_marker_deferred', {
        id: error.operationId,
        delay_ms: backoffMs,
      });
      return 'deferred';
    }

    const msg = error instanceof Error ? error.message : 'Sync error';
    const newRetries = item.retries + 1;
    const shouldRetry = shouldRetrySyncItemError(item.type, error);

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

    return 'failed';
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
    const chunkResult = await runUnheldProcessingChunk({
      registry: processingHolds,
      items: chunk,
      run: async (dispatchChunk) => {
        // Mark only the freshly re-filtered subchunk as syncing.
        const ids = new Set(dispatchChunk.map((i) => i.id));
        const updatedQueue = get().queue.map((i) =>
          ids.has(i.id) ? { ...i, status: 'syncing' as SyncItemStatus } : i
        );
        set({ queue: updatedQueue });

        let chunkSucceeded = 0;
        let chunkFailed = 0;
        try {
          await tryGpsBatchCreate(dispatchChunk);
          for (const item of dispatchChunk) {
            get().markDone(item.id);
            chunkSucceeded++;
          }
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : 'GPS sync error';
          for (const item of dispatchChunk) {
            handleGpsItemError(item, errMsg, get, set);
            chunkFailed++;
          }
        }
        return {
          processed: dispatchChunk.length,
          succeeded: chunkSucceeded,
          failed: chunkFailed,
        };
      },
    });
    if (chunkResult.dispatched) {
      processed += chunkResult.result.processed;
      succeeded += chunkResult.result.succeeded;
      failed += chunkResult.result.failed;
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

    // NOTA: los antiguos case 'refill'/'unload' (que posteaban a los modelos van
    // de recarga/descarga vía /api/create_update) se ELIMINARON. El flujo se
    // retiró: la recarga la crea Almacén y el vendedor la acepta; la devolución
    // (vendible + merma) se captura en el Corte. Cualquier evento legacy que quede
    // en cola lo intercepta el guard de processOneItem (isLegacyRefillUnloadItem) y
    // se migra (revierte stock + descarta); nunca llega a este dispatcher.

    // V2 types — basic dispatchers. Payloads follow the same
    // postRpc pattern. Backend contracts TBD per endpoint.
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

// ═══ Rollback V2 — genérico por `_localStockDelta` (+ sale_order) ═══

/** Marca el ítem como ya-revertido en la cola, para evitar doble rollback. */
function markLocalStockRolledBack(id: string): void {
  const queue = useSyncStore.getState().queue.map((i) =>
    i.id === id ? { ...i, payload: { ...i.payload, _localStockRolledBack: true } } : i,
  );
  useSyncStore.setState({ queue });
  persistQueueInBackground('rollback_marker');
}

function rollbackFailedOperation(item: SyncQueueItem): void {
  const updateLocalStock = useProductStore.getState().updateLocalStock;

  // PR-3a: rollback GENÉRICO por `_localStockDelta`, independiente del `type`.
  // Idempotente: computeLocalStockReversal devuelve [] si ya se revirtió
  // (`_localStockRolledBack`), y aquí marcamos el flag tras revertir. Si hay
  // delta, esta ruta es autoritativa (no cae al switch por-type).
  const reversal = computeLocalStockReversal(item.payload);
  if (reversal.length > 0) {
    reversal.forEach((r) => updateLocalStock(r.product_id, r.qty));
    markLocalStockRolledBack(item.id);
    logError('sync', 'rollback_local_stock_delta', {
      id: item.id,
      type: item.type,
      entries: reversal.length,
    });
    return;
  }
  // Sin delta (o ya revertido): rollback por-type para ítems que aún no llevan
  // `_localStockDelta`. Los antiguos case 'unload'/'refill' se ELIMINARON (el
  // flujo se retiró; los eventos legacy los intercepta el guard antes de morir).
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
