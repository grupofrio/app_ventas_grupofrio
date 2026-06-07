/**
 * Route store — plan and stops state.
 * Loaded on login/app open. Used by Home, Route, Stop screens.
 */

import { create } from 'zustand';
import { GFPlan, GFStop } from '../types/plan';
import { getMyPlan, getPlanStops } from '../services/gfLogistics';
// CROSS-STORE DEP: loads KOLD intelligence on route load. Documented in V1.3.1.
import { useKoldStore } from './useKoldStore';
import { useSyncStore } from './useSyncStore';
import { useVisitStore } from './useVisitStore';
import { storeSave, STORAGE_KEYS } from '../persistence/storage';
import { shouldResetVisitAfterPlanRefresh } from '../services/visitPersistence';
import { removeStopById } from '../services/routeStops';
import {
  mergeBackendStopsWithDrafts,
  stampMissingCreatedAt,
} from '../services/offrouteDrafts';
import {
  routeFreshnessStatus,
  routePlanVersionToken,
  shouldKeepCachedStopsAfterEmptyRefresh,
  shouldRefreshRouteCache,
  shouldReloadRouteStops,
} from '../services/routeRefreshPolicy';
import { logInfo, logWarn } from '../utils/logger';
import { visitTelemetryCounters } from '../utils/visitTelemetry';
import { createVirtualStop } from '../services/virtualStopFactory';

export type RouteFreshness = 'updated' | 'stale' | 'offline_cache';

interface RouteState {
  plan: GFPlan | null;
  stops: GFStop[];
  isLoading: boolean;
  error: string | null;
  lastSync: number | null; // timestamp
  routeFreshness: RouteFreshness;
  planVersionToken: string | null;

  // Derived
  stopsCompleted: number;
  stopsTotal: number;
  progressPct: number;

  // Actions
  loadPlan: (opts?: { force?: boolean }) => Promise<void>;
  updateStopState: (stopId: number, state: GFStop['state']) => void;
  removeStop: (stopId: number) => void;
  addVirtualStop: (
    customerId: number,
    customerName: string,
    opts?: {
      entityType?: 'customer' | 'lead';
      leadId?: number | null;
      partnerId?: number | null;
      offrouteVisitId?: number | null;
      pricelistId?: number | null;
      pricelistName?: string | null;
      customerLatitude?: number | null;
      customerLongitude?: number | null;
      googleMapsUrl?: string | null;
    },
  ) => number;
  patchStop: (stopId: number, patch: Partial<GFStop>) => void;
  reset: () => void;
}

export const useRouteStore = create<RouteState>((set, get) => ({
  plan: null,
  stops: [],
  isLoading: false,
  error: null,
  lastSync: null,
  routeFreshness: 'stale',
  planVersionToken: null,
  stopsCompleted: 0,
  stopsTotal: 0,
  progressPct: 0,

  loadPlan: async (opts = {}) => {
    if (get().isLoading) return; // Prevent concurrent calls

    const isOnline = useSyncStore.getState().isOnline;
    const now = Date.now();

    if (!useSyncStore.getState().isOnline) {
      // Keep any rehydrated cached plan visible when offline.
      set({
        isLoading: false,
        error: get().plan ? null : 'Sin conexion',
        routeFreshness: 'offline_cache',
      });
      return;
    }

    if (!shouldRefreshRouteCache({
      plan: get().plan,
      lastSync: get().lastSync,
      now,
      isOnline,
      force: opts.force,
    })) {
      set({
        routeFreshness: routeFreshnessStatus({
          plan: get().plan,
          lastSync: get().lastSync,
          now,
          isOnline,
        }),
      });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const visitStore = useVisitStore.getState();
      const cachedPlan = get().plan;
      const cachedStops = get().stops;
      const cachedToken = get().planVersionToken ?? routePlanVersionToken(cachedPlan);
      const plan = await getMyPlan();
      if (!plan) {
        if (shouldKeepCachedStopsAfterEmptyRefresh({
          cachedPlan,
          cachedStops,
          nextPlan: null,
          nextStops: [],
        })) {
          logWarn('general', 'route_refresh_kept_cached_stops', {
            reason: 'my_plan_empty',
            cached_plan_id: cachedPlan?.plan_id ?? null,
            cached_stop_count: cachedStops.length,
          });
          set({
            isLoading: false,
            error: 'No se pudo actualizar la ruta; mostrando ruta guardada',
            routeFreshness: 'stale',
          });
          return;
        }
        if (visitStore.currentStopId !== null) {
          visitStore.resetVisit();
        }
        set({
          plan: null,
          stops: [],
          isLoading: false,
          error: 'Sin plan para hoy',
          routeFreshness: 'stale',
          planVersionToken: null,
        });
        return;
      }

      const nextToken = routePlanVersionToken(plan);
      if (!shouldReloadRouteStops({
        cachedStopsCount: cachedStops.length,
        cachedToken,
        nextToken,
      })) {
        set({
          plan,
          isLoading: false,
          error: null,
          lastSync: now,
          routeFreshness: 'updated',
          planVersionToken: nextToken,
        });
        storeSave(STORAGE_KEYS.PLAN, plan);
        return;
      }

      const backendStops = await getPlanStops(plan.plan_id);
      const keepCachedStops = shouldKeepCachedStopsAfterEmptyRefresh({
        cachedPlan,
        cachedStops,
        nextPlan: plan,
        nextStops: backendStops,
      });

      // Preserve in-flight offroute drafts across refresh. Without this
      // merge, a backend refresh in the middle of an offroute sale would
      // wipe the virtual stop the user is currently operating on.
      // Stale drafts (TTL in offrouteDrafts.ts) are dropped here.
      const rawStops = keepCachedStops
        ? cachedStops
        : mergeBackendStopsWithDrafts(backendStops, cachedStops);

      if (keepCachedStops) {
        logWarn('general', 'route_refresh_kept_cached_stops', {
          reason: 'plan_stops_empty',
          plan_id: plan.plan_id,
          cached_stop_count: cachedStops.length,
        });
      }

      // F5: Load KOLD intelligence for all route partners
      const partnerIds = [...new Set(rawStops.map((s) => s.customer_id).filter(Boolean))];
      if (partnerIds.length > 0) {
        try {
          await useKoldStore.getState().loadForPartners(partnerIds);
        } catch {
          // KOLD modules may not exist — non-blocking
        }
      }

      // Enrich stops with score + forecast
      const koldStore = useKoldStore.getState();
      const stops = rawStops.map((s) => {
        const score = koldStore.getScore(s.customer_id);
        const forecast = koldStore.getForecast(s.customer_id);
        return {
          ...s,
          _koldScore: score ?? s._koldScore ?? undefined,
          _koldForecast: forecast ?? s._koldForecast ?? undefined,
        };
      });

      const completed = stops.filter((s) =>
        ['done', 'not_visited', 'no_stock', 'rejected', 'closed'].includes(s.state)
      ).length;
      const total = stops.length;

      if (shouldResetVisitAfterPlanRefresh(visitStore.currentStopId, stops)) {
        // Telemetry: validates that the ghost-stop reconciliation is
        // actually firing on real refreshes and not sitting unused.
        visitTelemetryCounters.reconcileResetTotal += 1;
        logInfo('visit', 'reconcile_reset', {
          previousStopId: visitStore.currentStopId,
          stopsLoaded: stops.length,
          totalTriggers: visitTelemetryCounters.reconcileResetTotal,
        });
        visitStore.resetVisit();
      }

      set({
        plan,
        stops,
        isLoading: false,
        error: keepCachedStops
          ? 'No se pudo actualizar paradas; mostrando ruta guardada'
          : null,
        lastSync: now,
        routeFreshness: keepCachedStops ? 'stale' : 'updated',
        planVersionToken: nextToken,
        stopsCompleted: completed,
        stopsTotal: total,
        progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
      });

      // F6: Persist for offline rehydration
      storeSave(STORAGE_KEYS.PLAN, plan);
      storeSave(STORAGE_KEYS.STOPS, stops);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Error cargando plan';
      set({ error: msg, isLoading: false });
    }
  },

  /**
   * BLD-20260408-P0: Create a virtual stop for off-route sales.
   * Uses negative IDs to distinguish from real backend stops.
   * Returns the virtual stop ID for navigation.
   */
  addVirtualStop: (customerId, customerName, opts) => {
    const virtualStop = createVirtualStop({
      customerId,
      customerName,
      entityType: opts?.entityType,
      leadId: opts?.leadId,
      partnerId: opts?.partnerId,
      offrouteVisitId: opts?.offrouteVisitId,
      pricelistId: opts?.pricelistId,
      pricelistName: opts?.pricelistName,
      customerLatitude: opts?.customerLatitude,
      customerLongitude: opts?.customerLongitude,
      googleMapsUrl: opts?.googleMapsUrl,
    });
    const virtualId = virtualStop.id;
    const stops = [...get().stops, virtualStop];
    set({ stops, stopsTotal: stops.length });
    // Persist immediately so a mid-flow crash can rehydrate the draft.
    storeSave(STORAGE_KEYS.STOPS, stops);
    return virtualId;
  },

  updateStopState: (stopId, state) => {
    const stops = get().stops.map((s) =>
      s.id === stopId ? { ...s, state } : s
    );
    const completed = stops.filter((s) =>
      ['done', 'not_visited', 'no_stock', 'rejected', 'closed'].includes(s.state)
    ).length;
    const total = stops.length;
    set({
      stops,
      stopsCompleted: completed,
      progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    });
    // F6: Persist updated stops
    storeSave(STORAGE_KEYS.STOPS, stops);
  },

  removeStop: (stopId) => {
    const stops = removeStopById(get().stops, stopId);
    const completed = stops.filter((s) =>
      ['done', 'not_visited', 'no_stock', 'rejected', 'closed'].includes(s.state)
    ).length;
    const total = stops.length;
    set({
      stops,
      stopsCompleted: completed,
      stopsTotal: total,
      progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    });
    storeSave(STORAGE_KEYS.STOPS, stops);
  },

  patchStop: (stopId, patch) => {
    const stops = get().stops.map((stop) => (
      stop.id === stopId ? { ...stop, ...patch } : stop
    ));
    set({ stops });
    storeSave(STORAGE_KEYS.STOPS, stops);
  },

  reset: () => set({
    plan: null, stops: [], isLoading: false, error: null,
    lastSync: null, routeFreshness: 'stale', planVersionToken: null,
    stopsCompleted: 0, stopsTotal: 0, progressPct: 0,
  }),
}));
