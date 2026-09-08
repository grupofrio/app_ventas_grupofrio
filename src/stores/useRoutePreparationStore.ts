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
import { useEmployeeDayBundleStore } from './useEmployeeDayBundleStore';
import {
  computeCustomerPrices,
  peekCachedCustomerPrices,
} from '../services/pricelist';
import {
  buildCustomerNameMap,
  dedupePartnerIds,
  PreparationFailure,
  buildRoutePreparationReceipt,
  receiptToStoreSnapshot,
  ROUTE_PREP_RECEIPT_PERSIST_WARNING,
} from '../services/routePreparationLogic';
import {
  clearRoutePreparationReceipt,
  loadRoutePreparationReceipt,
  saveRoutePreparationReceipt,
} from '../services/routePreparationPersistence';
import { schedulePersistPriceCache } from '../services/offlineCache';
import { logInfo, logWarn } from '../utils/logger';

const PREPARE_CONCURRENCY = 4; // matches preloadRouteCustomerPrices for parity

function buildPreparationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/tiempo de espera|timeout/i.test(message)) {
    return 'La conexión tardó demasiado. Conéctate al WiFi del CEDIS y vuelve a intentar.';
  }
  if (/network|sin conexión|conexi[oó]n.*perdida|offline/i.test(message)) {
    return 'No hay conexión estable. Verifica el WiFi del CEDIS e intenta de nuevo.';
  }
  return message || 'No se pudo preparar la ruta.';
}

async function persistPreparationReceipt(input: {
  planId: number;
  preparedAtMs: number;
  customersTotal: number;
  customersPrepared: number;
  pricesPrepared: number;
  failures: PreparationFailure[];
}): Promise<boolean> {
  const auth = useAuthStore.getState();
  const bundleRecord = useEmployeeDayBundleStore.getState().record;
  const operationalDate = bundleRecord?.bundle.operational_date;
  if (!auth.companyId || !auth.employeeId || !operationalDate) return false;
  try {
    const receipt = buildRoutePreparationReceipt({
      companyId: auth.companyId,
      employeeId: auth.employeeId,
      planId: input.planId,
      operationalDate,
      bundleEtag: bundleRecord?.etag ?? null,
      preparedAtMs: input.preparedAtMs,
      customersTotal: input.customersTotal,
      customersPrepared: input.customersPrepared,
      pricesPrepared: input.pricesPrepared,
      failures: input.failures,
    });
    await saveRoutePreparationReceipt(receipt);
    return true;
  } catch (error) {
    logWarn('general', 'route_prep_receipt_persist_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
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
  bundleExpired: boolean;
  receiptPersistWarning: string | null;

  prepareRouteData: () => Promise<void>;
  retryFailures: () => Promise<void>;
  resetPreparation: () => void;
  hydrate: () => Promise<void>;
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
  bundleExpired: false,
  receiptPersistWarning: null,

  hydrate: async () => {
    const auth = useAuthStore.getState();
    if (!auth.isAuthenticated || !auth.companyId || !auth.employeeId) {
      return;
    }
    await useEmployeeDayBundleStore.getState().hydrate();
    const receipt = await loadRoutePreparationReceipt();
    const dayBundle = useEmployeeDayBundleStore.getState();
    const route = useRouteStore.getState();
    const products = useProductStore.getState().products;
    const bundleOperationalDate = dayBundle.record?.bundle.operational_date ?? null;
    if (!bundleOperationalDate) {
      set({
        preparedAt: null,
        preparedPlanId: null,
        bundleExpired: false,
        receiptPersistWarning: null,
      });
      return;
    }
    const { assessRoutePreparationReceipt } = await import('../services/routePreparationReceipt.ts');
    const assessment = assessRoutePreparationReceipt(receipt, {
      companyId: auth.companyId,
      employeeId: auth.employeeId,
      operationalDate: bundleOperationalDate,
      nowMs: Date.now(),
      currentPlanId: route.plan?.plan_id ?? null,
      bundleCanStartRoute: dayBundle.access?.canStartRoute === true,
      hasPlan: !!route.plan,
      stopsCount: route.stops.length,
      productCount: products.length,
    });

    if (assessment.status === 'prepared' || assessment.status === 'prepared_bundle_expired') {
      set({
        ...receiptToStoreSnapshot(assessment.receipt),
        bundleExpired: assessment.status === 'prepared_bundle_expired',
        lastError: assessment.status === 'prepared_bundle_expired' ? assessment.message : null,
        receiptPersistWarning: null,
      });
      return;
    }

    if (assessment.status === 'invalid_receipt') {
      await clearRoutePreparationReceipt();
    }
    set({
      preparedAt: null,
      preparedPlanId: null,
      bundleExpired: false,
      receiptPersistWarning: null,
    });
  },

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
      // The versioned bundle is the critical offline snapshot. Do not fall
      // through to legacy route/catalog fetches if it is stale or unavailable.
      set({ currentStep: 'Validando datos del día' });
      await useEmployeeDayBundleStore.getState().prepare();
      const dayBundle = useEmployeeDayBundleStore.getState().access;
      if (!dayBundle?.canStartRoute) {
        set({
          isPreparing: false,
          currentStep: null,
          lastError: 'Los datos del día están vencidos. Solo puedes consultarlos hasta actualizarlos con conexión.',
        });
        return;
      }

      // ── Step 1: force-refresh plan/stops ───────────────────────────────────
      // F3.1: precarga FORZADA — antes esto solo recargaba si el caché en
      // memoria estaba vacío, así que "Preparar ruta" en un segundo tap (con
      // el plan ya rehidratado) no bajaba nada nuevo. `loadPlan({ force: true })`
      // invalida el caché y siempre pide de nuevo; su propio guard interno
      // (useRouteStore.ts) sigue siendo offline-safe: sin conexión, conserva
      // el plan cacheado tal cual en vez de fallar.
      await useRouteStore.getState().loadPlan({ force: true });
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

      // ── Step 2: force-refresh products ─────────────────────────────────────
      // Mismo criterio que el plan: forzar siempre que haya conexión.
      // loadProducts (a diferencia de loadPlan) no trae su propio guard de
      // conectividad, así que lo decidimos aquí — sin red, se conserva el
      // catálogo ya cargado en memoria en vez de intentar un fetch que
      // fallaría.
      set({ currentStep: 'Cargando productos' });
      const productStore = useProductStore.getState();
      if (auth.warehouseId && useSyncStore.getState().isOnline) {
        await productStore.loadProducts(auth.warehouseId);
      }
      const products = useProductStore.getState().products;

      if (products.length === 0) {
        // A partial download is not a prepared route. Keep the receipt absent
        // so every entry point stays blocked until products are available.
        set({
          isPreparing: false,
          currentStep: null,
          preparedAt: null,
          preparedPlanId: null,
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

      const preparedAtMs = Date.now();
      const persisted = await persistPreparationReceipt({
        planId: plan.plan_id!,
        preparedAtMs,
        customersTotal: total,
        customersPrepared: prepared,
        pricesPrepared: pricesCount,
        failures,
      });

      set({
        isPreparing: false,
        currentStep: null,
        preparedAt: preparedAtMs,
        preparedPlanId: plan.plan_id ?? null,
        failures,
        lastError: null,
        bundleExpired: false,
        receiptPersistWarning: persisted ? null : ROUTE_PREP_RECEIPT_PERSIST_WARNING,
      });

      logInfo('general', 'route_prep_completed', {
        plan_id: plan.plan_id,
        customers: total,
        prepared,
        failures: failures.length,
        prices: pricesCount,
      });
    } catch (err) {
      const message = buildPreparationErrorMessage(err);
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

    const preparedAtMs = Date.now();
    const state = get();
    let receiptPersistWarning: string | null = null;
    if (state.preparedPlanId) {
      const persisted = await persistPreparationReceipt({
        planId: state.preparedPlanId,
        preparedAtMs,
        customersTotal: state.customersTotal,
        customersPrepared: get().customersPrepared,
        pricesPrepared: get().pricesPrepared,
        failures: stillFailed,
      });
      if (!persisted) receiptPersistWarning = ROUTE_PREP_RECEIPT_PERSIST_WARNING;
    }

    set({
      isPreparing: false,
      currentStep: null,
      failures: stillFailed,
      preparedAt: preparedAtMs,
      receiptPersistWarning,
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
      bundleExpired: false,
      receiptPersistWarning: null,
    });
    void clearRoutePreparationReceipt();
  },
}));
