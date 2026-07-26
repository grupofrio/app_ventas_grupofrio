/**
 * Route preparation store — orchestrates the "Preparar ruta" CEDIS flow.
 *
 * Goal: at the depot with WiFi, pull every piece of data the vendor will
 * need to operate offline:
 *   1. plan + stops (useRouteStore.loadPlan)
 *   2. truck inventory (useProductStore.loadProducts)
 *   3. complete server prices for each customer/requested-list combination
 *
 * Pricing targets settle independently with bounded concurrency, then one
 * durable manifest is activated atomically. Failures retain the exact
 * requested pricelist so retry never fetches or replaces a successful pair.
 */

import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { useRouteStore } from './useRouteStore';
import { useProductStore } from './useProductStore';
import { useSyncStore } from './useSyncStore';
import { fetchServerCustomerPricingSnapshot } from '../services/pricelist';
import {
  buildCustomerNameMap,
  prepareRoutePricingTargets,
  refreshRoutePreparationCatalog,
  type PreparationFailure,
} from '../services/routePreparationLogic';
import { buildRoutePricingTargets } from '../services/routePricingTargets';
import {
  replacePreparedPricingRun,
} from '../services/customerPricingSnapshot';
import {
  updateCustomerPricingSnapshotState,
} from '../services/customerPricingSnapshotRepository';
import { logInfo, logWarn } from '../utils/logger';

const PREPARE_CONCURRENCY = 4;

function createPreparationRunId(kind: 'prepare' | 'retry'): string {
  return `route-pricing-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
    const preparationRequestedOnline = useSyncStore.getState().isOnline;

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
      let products = productStore.products;
      if (preparationRequestedOnline) {
        if (!auth.warehouseId) {
          set({
            isPreparing: false,
            currentStep: null,
            lastError: 'Almacén no disponible para actualizar productos.',
          });
          return;
        }
        const catalogRefresh = await refreshRoutePreparationCatalog({
          warehouseId: auth.warehouseId,
          loadAuthoritative: (warehouseId) =>
            useProductStore.getState().loadProductsAuthoritative(warehouseId),
          readCatalog: () => useProductStore.getState(),
        });
        if (!catalogRefresh.ok) {
          set({
            isPreparing: false,
            currentStep: null,
            lastError: catalogRefresh.reason === 'empty_catalog'
              ? 'Productos no disponibles. Pide carga al CEDIS y reintenta.'
              : 'No pudimos actualizar el catálogo actual. Revisa la conexión y reintenta.',
          });
          logWarn('general', 'route_prep_catalog_not_authoritative', {
            plan_id: plan.plan_id,
            warehouse_id: auth.warehouseId,
            reason: catalogRefresh.reason,
          });
          return;
        }
        products = [...catalogRefresh.products];
      } else if (products.length === 0 && auth.warehouseId) {
        await productStore.loadProducts(auth.warehouseId);
        products = useProductStore.getState().products;
      }

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
      if (
        typeof auth.companyId !== 'number'
        || !Number.isInteger(auth.companyId)
        || auth.companyId <= 0
      ) {
        throw new Error('Compañía no disponible para preparar precios.');
      }

      const targets = buildRoutePricingTargets(stops);
      const productFingerprint = [...new Set(
        products.map((product) => product.id),
      )].sort((left, right) => left - right).join(',');
      const nameMap = buildCustomerNameMap(stops);
      const total = targets.length;
      set({
        customersTotal: total,
        progressTotal: total,
        progressDone: 0,
        customersPrepared: 0,
        pricesPrepared: 0,
      });

      const settled = await prepareRoutePricingTargets({
        targets,
        companyId: auth.companyId,
        planId: plan.plan_id ?? null,
        preparationRunId: createPreparationRunId('prepare'),
        concurrency: PREPARE_CONCURRENCY,
        expectedProductFingerprint: productFingerprint,
        fetchTarget: (target) =>
          fetchServerCustomerPricingSnapshot(target.partnerId, products, {
            companyId: auth.companyId,
            fallbackPricelistId: target.requestedPricelistId,
          }),
        updateState: updateCustomerPricingSnapshotState,
      });
      const failures = settled.failures.map((failure) => ({
        ...failure,
        customerName: nameMap.get(failure.partnerId),
      }));
      for (const failure of failures) {
        logWarn('general', 'route_prep_target_failed', {
          partnerId: failure.partnerId,
          requestedPricelistId: failure.requestedPricelistId,
          reason: failure.reason,
        });
      }

      set({
        isPreparing: false,
        currentStep: null,
        progressDone: total,
        customersPrepared: settled.preparedCount,
        pricesPrepared: settled.pricesPrepared,
        preparedAt: settled.activationInput.activatedAtMs,
        preparedPlanId: plan.plan_id ?? null,
        failures,
        lastError: null,
      });

      logInfo('general', 'route_prep_completed', {
        plan_id: plan.plan_id,
        pricing_targets: total,
        prepared: settled.preparedCount,
        failures: failures.length,
        prices: settled.pricesPrepared,
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
    const {
      failures,
      isPreparing,
      preparedPlanId,
    } = get();
    if (isPreparing || failures.length === 0) return;

    const auth = useAuthStore.getState();
    const products = useProductStore.getState().products;
    if (products.length === 0) {
      set({ lastError: 'Sin productos cargados. Reintenta desde CEDIS.' });
      return;
    }
    if (
      typeof auth.companyId !== 'number'
      || !Number.isInteger(auth.companyId)
      || auth.companyId <= 0
    ) {
      set({ lastError: 'Compañía no disponible para reintentar precios.' });
      return;
    }

    set({ isPreparing: true, currentStep: 'Reintentando pendientes', lastError: null });

    try {
      const targets = failures.map((failure) => ({
        partnerId: failure.partnerId,
        requestedPricelistId: failure.requestedPricelistId,
      }));
      const productFingerprint = [...new Set(
        products.map((product) => product.id),
      )].sort((left, right) => left - right).join(',');
      const settled = await prepareRoutePricingTargets({
        targets,
        companyId: auth.companyId,
        planId: preparedPlanId,
        preparationRunId: createPreparationRunId('retry'),
        concurrency: PREPARE_CONCURRENCY,
        expectedProductFingerprint: productFingerprint,
        fetchTarget: (target) =>
          fetchServerCustomerPricingSnapshot(target.partnerId, products, {
            companyId: auth.companyId,
            fallbackPricelistId: target.requestedPricelistId,
          }),
        activateRun: replacePreparedPricingRun,
        updateState: updateCustomerPricingSnapshotState,
      });
      const customerNames = new Map(
        failures.map((failure) => [
          failure.partnerId,
          failure.customerName,
        ]),
      );
      const stillFailed: PreparationFailure[] = settled.failures.map(
        (failure) => ({
          ...failure,
          customerName: customerNames.get(failure.partnerId),
        }),
      );

      set((previous) => ({
        isPreparing: false,
        currentStep: null,
        progressDone: previous.progressTotal,
        customersPrepared:
          previous.customersPrepared + settled.preparedCount,
        pricesPrepared:
          previous.pricesPrepared + settled.pricesPrepared,
        failures: stillFailed,
        preparedAt: settled.activationInput.activatedAtMs,
      }));

      logInfo('general', 'route_prep_retry_done', {
        recovered: settled.preparedCount,
        still_failed: stillFailed.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      set({
        isPreparing: false,
        currentStep: null,
        lastError: message,
      });
      logWarn('general', 'route_prep_retry_fatal', { message });
    }
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
