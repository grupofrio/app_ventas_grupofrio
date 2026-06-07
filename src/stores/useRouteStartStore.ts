/**
 * Route start store — Sprint A.
 *
 * Caches the last-known readiness of the "Iniciar operación" sequence
 * (checklist completo, KM inicial capturado, carga aceptada) keyed by plan.
 * The backend is the source of truth; this store just remembers what the
 * hub screen last observed so the Home card can render readiness without a
 * network round-trip on every focus.
 *
 * Persisted across app restarts (in-memory + AsyncStorage) so a vendor who
 * killed the app after doing the checklist doesn't see "no preparado" again.
 */

import { create } from 'zustand';
import { storeSave, storeLoad, STORAGE_KEYS } from '../persistence/storage';
import { computeRouteStartReadiness } from '../services/routeStartLogic';
import { RouteStartReadiness } from '../types/routeStart';
import { logInfo } from '../utils/logger';

interface RouteStartState {
  planId: number | null;
  checklistComplete: boolean;
  kmInitial: number | null;
  loadAccepted: boolean;

  readiness: RouteStartReadiness;

  setForPlan: (planId: number) => void;
  setChecklistComplete: (done: boolean) => void;
  setKmInitial: (km: number | null) => void;
  setLoadAccepted: (accepted: boolean) => void;
  reset: () => void;
  hydrate: () => Promise<void>;
}

function recompute(s: {
  checklistComplete: boolean;
  kmInitial: number | null;
  loadAccepted: boolean;
}): RouteStartReadiness {
  return computeRouteStartReadiness({
    checklistComplete: s.checklistComplete,
    kmCaptured: s.kmInitial != null,
    loadAccepted: s.loadAccepted,
  });
}

const INITIAL = {
  planId: null as number | null,
  checklistComplete: false,
  kmInitial: null as number | null,
  loadAccepted: false,
};

function persist(state: RouteStartState): void {
  storeSave(STORAGE_KEYS.ROUTE_START, {
    planId: state.planId,
    checklistComplete: state.checklistComplete,
    kmInitial: state.kmInitial,
    loadAccepted: state.loadAccepted,
  }).catch(() => {});
}

export const useRouteStartStore = create<RouteStartState>((set, get) => ({
  ...INITIAL,
  readiness: recompute(INITIAL),

  /**
   * Bind the store to a plan. If the plan changed (new day / new plan),
   * reset readiness so stale flags from yesterday don't leak.
   */
  setForPlan: (planId) => {
    const prev = get().planId;
    if (prev === planId) return;
    const next = { ...INITIAL, planId };
    set({ ...next, readiness: recompute(next) });
    persist(get());
    logInfo('general', 'route_start_bind_plan', { planId, prev });
  },

  setChecklistComplete: (done) => {
    set((s) => {
      const next = { ...s, checklistComplete: done };
      return { checklistComplete: done, readiness: recompute(next) };
    });
    persist(get());
  },

  setKmInitial: (km) => {
    set((s) => {
      const next = { ...s, kmInitial: km };
      return { kmInitial: km, readiness: recompute(next) };
    });
    persist(get());
  },

  setLoadAccepted: (accepted) => {
    set((s) => {
      const next = { ...s, loadAccepted: accepted };
      return { loadAccepted: accepted, readiness: recompute(next) };
    });
    persist(get());
  },

  reset: () => {
    set({ ...INITIAL, readiness: recompute(INITIAL) });
    persist(get());
  },

  hydrate: async () => {
    try {
      const saved = await storeLoad<{
        planId: number | null;
        checklistComplete: boolean;
        kmInitial: number | null;
        loadAccepted: boolean;
      }>(STORAGE_KEYS.ROUTE_START);
      if (saved) {
        const next = {
          planId: saved.planId ?? null,
          checklistComplete: !!saved.checklistComplete,
          kmInitial: typeof saved.kmInitial === 'number' ? saved.kmInitial : null,
          loadAccepted: !!saved.loadAccepted,
        };
        set({ ...next, readiness: recompute(next) });
      }
    } catch {
      // ignore — store stays at INITIAL
    }
  },
}));
