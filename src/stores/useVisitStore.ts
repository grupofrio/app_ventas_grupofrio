/**
 * Visit store — manages the active visit flow state.
 * Tracks: current stop, check-in time, visit timer, sale data, photos.
 *
 * State machine:
 *   idle → checked_in → (sale | no_sale) → checked_out
 */

import { create } from 'zustand';
import { GFStop } from '../types/plan';
import { storeRemove, storeSave, STORAGE_KEYS } from '../persistence/storage';
import { PersistedVisitSnapshot, buildVisitSnapshot } from '../services/visitPersistence';
import { buildStartedVisitState, createInitialVisitState } from '../services/visitState';
import { appendVisitPhotoUri } from '../services/visitPhotos';

export type VisitPhase = 'idle' | 'checked_in' | 'selling' | 'no_selling' | 'checked_out';

export interface SaleLineItem {
  productId: number;
  productName: string;
  price: number;
  qty: number;
  stock: number;
  weight: number; // kg per unit
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
  updateSaleQty: (productId: number, qty: number) => void;
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

  // Computed
  saleSubtotal: () => number;
  saleTax: () => number;
  saleTotal: () => number;
  saleTotalKg: () => number;

  // V1.2: Stock validation
  hasStockIssues: () => boolean;
  getStockIssues: () => Array<{ productId: number; name: string; requested: number; available: number }>;

  // V1.2: Confirm lock
  lockSaleConfirm: () => string; // Returns operationId
  unlockSaleConfirm: () => void;
}

const initialState = createInitialVisitState();

function persistVisitState(state: {
  phase: VisitPhase;
  currentStopId: number | null;
  currentStop: GFStop | null;
  offrouteVisitId: number | null;
  checkInTime: number | null;
  checkInLat: number | null;
  checkInLon: number | null;
  elapsedSeconds: number;
  saleConfirmed?: boolean;
  saleOperationId?: string | null;
}) {
  const snapshot = buildVisitSnapshot(state);
  if (snapshot) {
    void storeSave(STORAGE_KEYS.VISIT_STATE, snapshot);
    return;
  }
  void storeRemove(STORAGE_KEYS.VISIT_STATE);
}

export const useVisitStore = create<VisitState>((set, get) => ({
  ...initialState,

  startVisit: (stop, lat, lon) => {
    const nextState = buildStartedVisitState(stop, lat, lon);
    set(nextState);
    persistVisitState(nextState);
  },

  endVisit: (_lat, _lon) => {
    set({ phase: 'checked_out' });
    persistVisitState({ ...get(), phase: 'checked_out' });
  },

  setPhase: (phase) => {
    set({ phase });
    persistVisitState({ ...get(), phase });
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
    persistVisitState({ ...get(), offrouteVisitId, currentStop });
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

  updateSaleQty: (productId, qty) => set({
    saleLines: qty <= 0
      ? get().saleLines.filter((l) => l.productId !== productId)
      : get().saleLines.map((l) =>
          l.productId === productId ? { ...l, qty: Math.min(qty, l.stock) } : l
        ),
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
      set({ elapsedSeconds });
      persistVisitState({ ...get(), elapsedSeconds });
    }
  },

  // Reset
  resetVisit: () => {
    set({ ...initialState });
    persistVisitState({ ...initialState });
  },

  restoreVisit: (snapshot) => {
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
      saleConfirmed: snapshot.saleConfirmed ?? false,
      saleOperationId: snapshot.saleOperationId ?? null,
    });
    persistVisitState(snapshot);
  },

  // Computed
  saleSubtotal: () => get().saleLines.reduce((sum, l) => sum + l.price * l.qty, 0),
  saleTax: () => 0,
  saleTotal: () => get().saleSubtotal(),
  saleTotalKg: () => get().saleLines.reduce((sum, l) => sum + l.weight * l.qty, 0),

  // V1.2: Stock validation — checks if any line exceeds available stock
  hasStockIssues: () => {
    return get().saleLines.some((l) => l.qty > l.stock);
  },

  getStockIssues: () => {
    return get().saleLines
      .filter((l) => l.qty > l.stock)
      .map((l) => ({
        productId: l.productId,
        name: l.productName,
        requested: l.qty,
        available: l.stock,
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
    set({ saleConfirmed: true, saleOperationId: opId });
    // Persist immediately so a crash right after locking still blocks re-confirm.
    persistVisitState({ ...get() });
    return opId;
  },

  unlockSaleConfirm: () => {
    set({ saleConfirmed: false, saleOperationId: null });
    persistVisitState({ ...get() });
  },
}));
