/**
 * Visit store — manages the active visit flow state.
 * Tracks: current stop, check-in time, visit timer, sale data, photos.
 *
 * State machine:
 *   idle → checked_in → (sale | no_sale) → checked_out
 */

import { create } from 'zustand';
import { GFStop } from '../types/plan';
import { storeRemoveStrict, storeSaveStrict, STORAGE_KEYS } from '../persistence/storage';
import { PersistedVisitSnapshot, buildVisitSnapshot, shouldPersistVisitTick } from '../services/visitPersistence';
import {
  buildStartedVisitState,
  createInitialVisitState,
  restoreSaleRecoveryState,
} from '../services/visitState';
import { appendVisitPhotoUri } from '../services/visitPhotos';
import {
  createVisitStatePersistenceCoordinator,
  VisitStatePersistenceCoordinator,
} from '../services/visitStatePersistence';
import { logError } from '../utils/logger';
import {
  createSaleRecoveryIntent,
  type SaleRecoveryIntentV1,
} from '../services/saleRecoveryIntent';

export type VisitPhase = 'idle' | 'checked_in' | 'selling' | 'no_selling' | 'checked_out';

// Perf Fase 1B: cada cuántos segundos persiste el snapshot el tick del timer
// (el contador visible sigue actualizándose cada segundo en memoria).
const VISIT_TICK_PERSIST_INTERVAL_S = 20;

export interface SaleLineItem {
  productId: number;
  productName: string;
  price: number;
  priceSource?: 'prepared_customer' | 'last_known_customer' | 'public_fallback';
  priceCapturedAtMs?: number | null;
  pricelistId?: number | null;
  qty: number;
  stock: number | null;
  weight: number; // kg per unit
}

export interface SaleStockOptions {
  enforceStock?: boolean;
}

export interface SaleStockIssue {
  productId: number;
  name: string;
  requested: number;
  available: number | null;
}

interface VisitState {
  // Current visit
  phase: VisitPhase;
  currentStopId: number | null;
  currentStop: GFStop | null;
  offrouteVisitId: number | null;

  // Check-in data
  checkInTime: number | null; // timestamp ms
  checkInLat: number | null;
  checkInLon: number | null;
  elapsedSeconds: number;

  // Sale data
  saleLines: SaleLineItem[];
  salePaymentMethod: 'cash' | 'credit' | null;
  analyticPlazaId: number | null;
  analyticUnId: number | null;
  salePhotoTaken: boolean;
  salePhotoUri: string | null;
  salePhotoUris: string[];

  // No-sale data
  noSaleReasonId: number | null;
  noSaleReasonLabel: string;
  noSaleCompetitor: string | null;
  noSaleNotes: string;
  noSalePhotoTaken: boolean;
  noSalePhotoUri: string | null;
  noSalePhotoUris: string[];

  // Actions
  startVisit: (stop: GFStop, lat: number, lon: number) => void;
  endVisit: (lat: number, lon: number) => void;
  setPhase: (phase: VisitPhase) => void;
  setOffrouteVisitId: (offrouteVisitId: number | null) => void;

  // Sale actions
  addSaleLine: (line: SaleLineItem) => void;
  updateSaleQty: (
    productId: number,
    qty: number,
    options?: { enforceStock?: boolean },
  ) => void;
  removeSaleLine: (productId: number) => void;
  setSalePayment: (method: 'cash' | 'credit') => void;
  setSaleAnalyticPlaza: (analyticPlazaId: number | null) => void;
  setSaleAnalyticUn: (analyticUnId: number | null) => void;
  setSalePhoto: (uri: string) => void;

  // No-sale actions
  setNoSaleReason: (id: number, label: string) => void;
  setNoSaleCompetitor: (brand: string | null) => void;
  setNoSaleNotes: (notes: string) => void;
  setNoSalePhoto: (uri: string) => void;

  // Timer
  tickTimer: () => void;

  // Reset
  resetVisit: () => void;
  restoreVisit: (snapshot: PersistedVisitSnapshot) => void;

  // V1.2: Anti-duplicate
  saleConfirmed: boolean;        // Prevents double-tap
  saleOperationId: string | null; // Idempotency key for this sale
  saleReadyToContinue: boolean;
  saleRecoveryPersistenceFailed: boolean;
  saleRecoveryIntent: SaleRecoveryIntentV1 | null;

  // Computed
  saleSubtotal: () => number;
  saleTax: () => number;
  saleTotal: () => number;
  saleTotalKg: () => number;

  // V1.2: Stock validation
  hasStockIssues: (options?: { enforceStock?: boolean }) => boolean;
  getStockIssues: (options?: { enforceStock?: boolean }) => SaleStockIssue[];

  // V1.2: Confirm lock
  lockSaleConfirm: () => string; // Returns operationId
  unlockSaleConfirm: () => void;
  setSaleRecoveryPersistenceFailed: (value: boolean) => void;
  persistSaleConfirmationLock: (
    operationId: string,
    intent: SaleRecoveryIntentV1,
  ) => Promise<boolean>;
  markSaleReadyToContinue: (
    operationId: string,
    options?: { clearOperationId?: boolean },
  ) => Promise<boolean>;
  clearSaleConfirmationLock: (operationId: string) => Promise<boolean>;
}

const initialState = createInitialVisitState();

const visitStatePersistence: VisitStatePersistenceCoordinator =
  createVisitStatePersistenceCoordinator<VisitState, PersistedVisitSnapshot>({
    read: () => useVisitStore.getState(),
    selectSnapshot: buildVisitSnapshot,
    save: (snapshot) => storeSaveStrict(STORAGE_KEYS.VISIT_STATE, snapshot),
    remove: () => storeRemoveStrict(STORAGE_KEYS.VISIT_STATE),
    publishSaleRecovery: (patch) => useVisitStore.setState(patch),
  });

function persistVisitStateInBackground(source: string): void {
  void visitStatePersistence.persistCurrent().catch((error: unknown) => {
    logError('visit', 'visit_state_persist_failed', {
      source,
      message: error instanceof Error ? error.message : 'Unknown visit persistence error',
    });
  });
}

export const useVisitStore = create<VisitState>((set, get) => ({
  ...initialState,

  startVisit: (stop, lat, lon) => {
    const nextState = buildStartedVisitState(stop, lat, lon);
    set(nextState);
    persistVisitStateInBackground('start_visit');
  },

  endVisit: (_lat, _lon) => {
    set({ phase: 'checked_out' });
    persistVisitStateInBackground('end_visit');
  },

  setPhase: (phase) => {
    set({ phase });
    persistVisitStateInBackground('set_phase');
  },

  setOffrouteVisitId: (offrouteVisitId) => {
    // BLD-20260424-STAB: extraer get().currentStop a const local para que
    // TypeScript narrowee correctamente. La versión anterior llamaba al
    // getter dos veces (truthy check + spread) y TS lo trataba como
    // GFStop|null|undefined en cada call site, lo que producía un objeto
    // con todas las propiedades requeridas convertidas en opcionales.
    const stop = get().currentStop;
    const currentStop: GFStop | null = stop
      ? { ...stop, _offrouteVisitId: offrouteVisitId }
      : null;
    set({ offrouteVisitId, currentStop });
    persistVisitStateInBackground('set_offroute_visit');
  },

  // Sale
  addSaleLine: (line) => {
    const existing = get().saleLines.find((l) => l.productId === line.productId);
    if (existing) {
      set({
        saleLines: get().saleLines.map((l) =>
          l.productId === line.productId ? { ...l, qty: l.qty + line.qty } : l
        ),
      });
    } else {
      set({ saleLines: [...get().saleLines, line] });
    }
  },

  updateSaleQty: (productId, qty, options) => set((state) => {
    const enforceStock = options?.enforceStock !== false;
    if (!Number.isSafeInteger(qty)) return state;
    if (qty <= 0) {
      return enforceStock
        ? { saleLines: state.saleLines.filter((line) => line.productId !== productId) }
        : state;
    }

    return {
      saleLines: state.saleLines.map((line) => {
        if (line.productId !== productId) return line;
        if (!enforceStock) return { ...line, qty };
        if (
          typeof line.stock !== 'number'
          || !Number.isFinite(line.stock)
          || line.stock <= 0
        ) return line;
        return { ...line, qty: Math.min(qty, Math.floor(line.stock)) };
      }),
    };
  }),

  removeSaleLine: (productId) => set({
    saleLines: get().saleLines.filter((l) => l.productId !== productId),
  }),

  setSalePayment: (method) => set({ salePaymentMethod: method }),
  setSaleAnalyticPlaza: (analyticPlazaId) => set({ analyticPlazaId }),
  setSaleAnalyticUn: (analyticUnId) => set({ analyticUnId }),
  setSalePhoto: (uri) => set((state) => ({
    salePhotoTaken: true,
    salePhotoUri: uri,
    salePhotoUris: appendVisitPhotoUri(state.salePhotoUris, uri),
  })),

  // No-sale
  setNoSaleReason: (id, label) => set({ noSaleReasonId: id, noSaleReasonLabel: label }),
  setNoSaleCompetitor: (brand) => set({ noSaleCompetitor: brand }),
  setNoSaleNotes: (notes) => set({ noSaleNotes: notes }),
  setNoSalePhoto: (uri) => set((state) => ({
    noSalePhotoTaken: true,
    noSalePhotoUri: uri,
    noSalePhotoUris: appendVisitPhotoUri(state.noSalePhotoUris, uri),
  })),

  // Timer
  tickTimer: () => {
    const { checkInTime } = get();
    if (checkInTime) {
      const elapsedSeconds = Math.floor((Date.now() - checkInTime) / 1000);
      // El contador visible se actualiza cada segundo (estado en memoria,
      // barato). Perf Fase 1B: NO escribir AsyncStorage cada segundo —
      // persistir solo cada VISIT_TICK_PERSIST_INTERVAL_S; al rehidratar el
      // elapsed se recomputa de checkInTime, así que no se pierde duración.
      set({ elapsedSeconds });
      if (shouldPersistVisitTick(elapsedSeconds, VISIT_TICK_PERSIST_INTERVAL_S)) {
        persistVisitStateInBackground('visit_timer');
      }
    }
  },

  // Reset
  resetVisit: () => {
    set({ ...initialState });
    persistVisitStateInBackground('reset_visit');
  },

  restoreVisit: (snapshot) => {
    const saleRecoveryState = restoreSaleRecoveryState(snapshot);
    set({
      phase: snapshot.phase,
      currentStopId: snapshot.currentStopId,
      currentStop: snapshot.currentStop,
      offrouteVisitId: snapshot.offrouteVisitId,
      checkInTime: snapshot.checkInTime,
      checkInLat: snapshot.checkInLat,
      checkInLon: snapshot.checkInLon,
      elapsedSeconds: snapshot.elapsedSeconds,
      // P0-2: restore sale confirmation + idempotency key (back-compat: old
      // snapshots without these fields default to not-confirmed).
      ...saleRecoveryState,
    });
    persistVisitStateInBackground('restore_visit');
  },

  // Computed
  saleSubtotal: () => get().saleLines.reduce((sum, l) => sum + l.price * l.qty, 0),
  saleTax: () => 0,
  saleTotal: () => get().saleSubtotal(),
  saleTotalKg: () => get().saleLines.reduce((sum, l) => sum + l.weight * l.qty, 0),

  // V1.2: Stock validation — checks if any line exceeds available stock
  hasStockIssues: (options) => {
    const enforceStock = options?.enforceStock !== false;
    return get().saleLines.some((line) => {
      if (!Number.isSafeInteger(line.qty) || line.qty <= 0) return true;
      return enforceStock
        && typeof line.stock === 'number'
        && Number.isFinite(line.stock)
        && line.qty > line.stock;
    });
  },

  getStockIssues: (options) => {
    const enforceStock = options?.enforceStock !== false;
    return get().saleLines
      .filter((line) => (
        !Number.isSafeInteger(line.qty)
        || line.qty <= 0
        || (
          enforceStock
          && typeof line.stock === 'number'
          && Number.isFinite(line.stock)
          && line.qty > line.stock
        )
      ))
      .map((line) => ({
        productId: line.productId,
        name: line.productName,
        requested: line.qty,
        available: line.stock,
      }));
  },

  // V1.2 + P0-2: Anti-duplicate — lock confirm, generate idempotency key ONCE.
  // If a sale is already confirmed for this visit AND still has its operationId
  // (e.g. restored after a crash), REUSE it instead of minting a new one — this
  // prevents a duplicate sale with a fresh operation_id on retry/restart.
  lockSaleConfirm: () => {
    const existing = get().saleOperationId;
    if (get().saleConfirmed && existing) {
      return existing;
    }
    const opId = `sale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    set({
      saleConfirmed: true,
      saleOperationId: opId,
      saleReadyToContinue: false,
      saleRecoveryPersistenceFailed: false,
      saleRecoveryIntent: null,
    });
    // The complete lock + recovery intent is persisted by the strict barrier.
    // A background write here could serialize a lock-only crash state.
    return opId;
  },

  unlockSaleConfirm: () => {
    set({
      saleConfirmed: false,
      saleOperationId: null,
      saleReadyToContinue: false,
      saleRecoveryPersistenceFailed: false,
      saleRecoveryIntent: null,
    });
    persistVisitStateInBackground('unlock_sale_confirm');
  },

  setSaleRecoveryPersistenceFailed: (value) => {
    set({ saleRecoveryPersistenceFailed: value });
    persistVisitStateInBackground('set_sale_recovery_persistence_failed');
  },

  persistSaleConfirmationLock: (operationId, intent) =>
    visitStatePersistence.persistSaleConfirmationLock(
      operationId,
      createSaleRecoveryIntent(intent),
    ),

  markSaleReadyToContinue: (operationId, options) =>
    visitStatePersistence.markSaleReadyToContinue(operationId, options),

  clearSaleConfirmationLock: (operationId) =>
    visitStatePersistence.clearSaleConfirmationLock(operationId),
}));
