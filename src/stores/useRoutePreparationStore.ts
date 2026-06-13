/**
 * Route preparation store — orchestrates the "Preparar ruta" CEDIS flow.
 *
 * Goal: at the depot with WiFi, pull every piece of data the vendor will
 * need to operate offline:
 *   1. plan + stops (useRouteStore.loadPlan)
 *   2. truck inventory (useProductStore.loadProducts)
 *   3. customer-specific prices (preloadRouteCustomerPrices, PR #14)
 *
 * Reuses existing services — no new endpoints. Reuses preload concurrency
 * limits and in-flight dedupe added in PR #14, so a manual prepare on top
 * of the auto-preload is still safe (in-flight HIT, no dup RPCs).
 *
 * Failures are captured PER-PARTNER so a single bad client doesn't abort
 * the whole preparation. Vendor sees a "Pendientes: N" + "Reintentar" UI.
 */

import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { useRouteStore } from './useRouteStore';
import { useProductStore } from './useProductStore';
import { useSyncStore } from './useSyncStore';
import {
  computeCustomerPrices,
  peekCachedCustomerPrices,
} from '../services/pricelist';
import {
  buildCustomerNameMap,
  dedupePartnerIds,
  PreparationFailure,
} from '../services/routePreparationLogic';
import { schedulePersistPriceCache } from '../services/offlineCache';
import { logInfo, logWarn } from '../utils/logger';

const PREPARE_CONCURRENCY = 4; // matches preloadRouteCustomerPrices for parity

interface RoutePreparationState {
  isPreparing: boolean;
  preparedAt: number | null;
  preparedPlanId: number | null;
  currentStep: string | null;
  progressDone: number;
  progressTotal: number;
  customersTotal: number;
  customersPrepared: number;
  pricesPrepared: number;
  failures: PreparationFailure[];
  lastError: string | null;

  prepareRouteData: () => Promise<void>;
  retryFailures: () => Promise<void>;
  resetPreparation: () => void;
}

export const useRoutePreparationStore = create<RoutePreparationState>((set, get) => ({
  isPreparing: false,
  preparedAt: null,
  preparedPlanId: null,
  currentStep: null,
  progressDone: 0,
  progressTotal: 0,
  customersTotal: 0,
  customersPrepared: 0,
  pricesPrepared: 0,
  failures: [],
  lastError: null,

  prepareRouteData: async () => {
    if (get().isPreparing) {
      logInfo('general', 'route_prep_already_running', {});
      return;
    }

    const auth = useAuthStore.getState();
    if (!auth.isAuthenticated) {
      set({ lastError: 'Sesión no iniciada. Vuelve a entrar.' });
      return;
    }

    set({
      isPreparing: true,
      lastError: null,
      failures: [],
      currentStep: 'Cargando ruta',
      progressDone: 0,
      progressTotal: 0,
      customersTotal: 0,
      customersPrepared: 0,
      pricesPrepared: 0,
    });

    try {
      // ── Step 1: ensure plan/stops ─────────────────────────────────────────
      const route = useRouteStore.getState();
      if (route.stops.length === 0 && useSyncStore.getState().isOnline) {
        await route.loadPlan();
      }
      const refreshedRoute = useRouteStore.getState();
      const plan = refreshedRoute.plan;
      const stops = refreshedRoute.stops;

      if (!plan || stops.length === 0) {
        set({
          isPreparing: false,
          currentStep: null,
          lastError: 'No hay plan o paradas para preparar.',
        });
        return;
      }

      // ── Step 2: ensure products ───────────────────────────────────────────
      set({ currentStep: 'Cargando productos' });
      const productStore = useProductStore.getState();
      if (productStore.products.length === 0 && auth.warehouseId) {
        await productStore.loadProducts(auth.warehouseId);
      }
      const products = useProductStore.getState().products;

      if (products.length === 0) {
        // Continue anyway — without products we can't preload prices, but
        // the plan/stops are already cached for the offline read path.
        set({
          isPreparing: false,
          currentStep: null,
          preparedAt: Date.now(),
          preparedPlanId: plan.plan_id ?? null,
          lastError: 'Productos no disponibles. Pide carga al CEDIS y reintenta.',
        });
        logWarn('general', 'route_prep_no_products', { plan_id: plan.plan_id });
        return;
      }

      // ── Step 3: preload customer prices ──────────────────────────────────
      set({ currentStep: 'Precargando precios' });
      const partnerIds = dedupePartnerIds(stops);
      const nameMap = buildCustomerNameMap(stops);
      const total = partnerIds.length;
      set({
        customersTotal: total,
        progressTotal: total,
        progressDone: 0,
        customersPrepared: 0,
        pricesPrepared: 0,
      });

      const failures: PreparationFailure[] = [];
      let prepared = 0;
      let pricesCount = 0;

      // Bounded-concurrency worker pool — same shape as
      // preloadRouteCustomerPrices in pricelist.ts. We don't just call that
      // helper because we need per-partner failure granularity for the UI.
      let cursor = 0;
      async function worker(): Promise<void> {
        while (cursor < partnerIds.length) {
          const idx = cursor++;
          const partnerId = partnerIds[idx];

          // Skip cached — preload (or another worker) already populated it.
          const cached = peekCachedCustomerPrices(partnerId, products, {
            companyId: auth.companyId,
          });
          if (cached) {
            prepared += 1;
            pricesCount += cached.size;
            set({
              customersPrepared: prepared,
              pricesPrepared: pricesCount,
              progressDone: prepared,
            });
            continue;
          }

          try {
            const map = await computeCustomerPrices(partnerId, products, {
              companyId: auth.companyId,
            });
            prepared += 1;
            pricesCount += map.size;
            set({
              customersPrepared: prepared,
              pricesPrepared: pricesCount,
              progressDone: prepared,
            });
          } catch (err) {
            const reason = err instanceof Error ? err.message : 'Error desconocido';
            failures.push({
              partnerId,
              customerName: nameMap.get(partnerId),
              reason,
            });
            // Still advance progressDone so the bar reaches 100%; the
            // failure card will surface the count separately.
            set({
              progressDone: prepared + failures.length,
              failures: [...failures],
            });
            logWarn('general', 'route_prep_partner_failed', { partnerId, reason });
          }
        }
      }

      const workerCount = Math.min(PREPARE_CONCURRENCY, partnerIds.length || 1);
      const workers: Promise<void>[] = [];
      for (let i = 0; i < workerCount; i++) workers.push(worker());
      await Promise.all(workers);

      // Perf Fase 2B: persistir el caché de precios precargado para que
      // sobreviva un reinicio en ruta (lectura offline en el ProductPicker).
      schedulePersistPriceCache();

      set({
        isPreparing: false,
        currentStep: null,
        preparedAt: Date.now(),
        preparedPlanId: plan.plan_id ?? null,
        failures,
        lastError: null,
      });

      logInfo('general', 'route_prep_completed', {
        plan_id: plan.plan_id,
        customers: total,
        prepared,
        failures: failures.length,
        prices: pricesCount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      set({
        isPreparing: false,
        currentStep: null,
        lastError: message,
      });
      logWarn('general', 'route_prep_fatal', { message });
    }
  },

  retryFailures: async () => {
    const { failures, isPreparing } = get();
    if (isPreparing || failures.length === 0) return;

    const auth = useAuthStore.getState();
    const products = useProductStore.getState().products;
    if (products.length === 0) {
      set({ lastError: 'Sin productos cargados. Reintenta desde CEDIS.' });
      return;
    }

    set({ isPreparing: true, currentStep: 'Reintentando pendientes', lastError: null });

    const stillFailed: PreparationFailure[] = [];
    let recovered = 0;

    for (const failure of failures) {
      try {
        const map = await computeCustomerPrices(failure.partnerId, products, {
          companyId: auth.companyId,
        });
        recovered += 1;
        const newPrices = map.size;
        set((prev) => ({
          customersPrepared: prev.customersPrepared + 1,
          pricesPrepared: prev.pricesPrepared + newPrices,
        }));
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Error desconocido';
        stillFailed.push({ ...failure, reason });
      }
    }

    // Perf Fase 2B: persistir lo recuperado en el reintento.
    schedulePersistPriceCache();

    set({
      isPreparing: false,
      currentStep: null,
      failures: stillFailed,
      preparedAt: Date.now(),
    });

    logInfo('general', 'route_prep_retry_done', { recovered, still_failed: stillFailed.length });
  },

  resetPreparation: () => {
    set({
      isPreparing: false,
      preparedAt: null,
      preparedPlanId: null,
      currentStep: null,
      progressDone: 0,
      progressTotal: 0,
      customersTotal: 0,
      customersPrepared: 0,
      pricesPrepared: 0,
      failures: [],
      lastError: null,
    });
  },
}));
