/**
 * Pure helpers for route preparation.
 *
 * Kept side-effect-free so they can be unit-tested without React Native /
 * zustand. The store (`useRoutePreparationStore`) wires them up to the real
 * route, product and pricelist services.
 */

import {
  activatePreparedPricingRun,
  type ActivatePreparedPricingRunInput,
  type ActivatePreparedPricingTargetInput,
  type PricingSnapshotStateV1,
  type ValidatedServerPriceSnapshot,
} from './customerPricingSnapshot.ts';
import type {
  RoutePricingTarget,
} from './routePricingTargets.ts';
import type { InventoryLoadResult } from './legacyRefreshRunner.ts';
import type { InventoryFreshness } from './effectiveOfflineCatalog.ts';

export interface RoutePreparationCatalogState<TProduct> {
  readonly products: readonly TProduct[];
  readonly error: string | null;
  readonly inventorySource: 'truck_stock' | 'stock_quant' | 'global_legacy' | null;
  readonly loadedWarehouseId: number | null;
  readonly fromCache: boolean;
  readonly inventoryFreshness: InventoryFreshness;
}

export type RoutePreparationCatalogResult<TProduct> =
  | {
      readonly ok: true;
      readonly products: readonly TProduct[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | Exclude<InventoryLoadResult, { ok: true }>['reason']
        | 'catalog_not_authoritative'
        | 'empty_catalog';
    };

/**
 * Refreshes the exact warehouse catalog used by an explicit online route
 * preparation. A populated cache is deliberately ignored as proof of freshness:
 * only the post-refresh authoritative state can feed pricing preparation.
 */
export async function refreshRoutePreparationCatalog<TProduct>(input: {
  readonly warehouseId: number;
  readonly loadAuthoritative: (
    warehouseId: number,
  ) => Promise<InventoryLoadResult>;
  readonly readCatalog: () => RoutePreparationCatalogState<TProduct>;
}): Promise<RoutePreparationCatalogResult<TProduct>> {
  const loadResult = await input.loadAuthoritative(input.warehouseId);
  if (!loadResult.ok) {
    return { ok: false, reason: loadResult.reason };
  }

  const catalog = input.readCatalog();
  if (
    loadResult.warehouseId !== input.warehouseId
    || catalog.error !== null
    || catalog.inventorySource !== loadResult.source
    || catalog.loadedWarehouseId !== input.warehouseId
    || catalog.fromCache
    || catalog.inventoryFreshness !== 'authoritative'
  ) {
    return { ok: false, reason: 'catalog_not_authoritative' };
  }
  if (catalog.products.length === 0) {
    return { ok: false, reason: 'empty_catalog' };
  }
  return { ok: true, products: [...catalog.products] };
}

export interface PreparationFailure {
  partnerId: number;
  requestedPricelistId: number | null;
  customerName?: string;
  reason: string;
}

export interface PartnerLike {
  customer_id?: number | null;
  customer_name?: string | null;
}

const MAX_ROUTE_PRICING_CONCURRENCY = 4;
const INVALID_PRICING_RESPONSE_REASON =
  'Respuesta de precios incompleta o inválida';
const STALE_PREPARATION_REASON =
  'Se conservaron precios más recientes para esta combinación';

export interface SettleRoutePricingTargetsInput {
  readonly targets: readonly RoutePricingTarget[];
  readonly companyId: number;
  readonly planId: number | null;
  readonly preparationRunId: string;
  readonly concurrency?: number;
  readonly expectedProductFingerprint?: string;
  readonly nowMs?: () => number;
  readonly fetchTarget: (target: RoutePricingTarget) => Promise<unknown>;
}

export interface SettledRoutePricingPreparation {
  readonly activationInput: ActivatePreparedPricingRunInput;
  readonly failures: readonly PreparationFailure[];
  readonly preparedCount: number;
  readonly pricesPrepared: number;
}

type ActivatePricingRun = (
  current: PricingSnapshotStateV1,
  input: ActivatePreparedPricingRunInput,
) => PricingSnapshotStateV1;

export interface PrepareRoutePricingTargetsInput
  extends SettleRoutePricingTargetsInput {
  readonly updateState: (
    updater: (current: PricingSnapshotStateV1) => PricingSnapshotStateV1,
  ) => Promise<PricingSnapshotStateV1>;
  readonly activateRun?: ActivatePricingRun;
}

function isCompleteValidatedPricingSnapshot(
  value: unknown,
  expectedProductFingerprint?: string,
): value is ValidatedServerPriceSnapshot {
  if (
    typeof value !== 'object'
    || value === null
    || (value as { ok?: unknown }).ok !== true
  ) {
    return false;
  }

  const candidate = value as {
    resolvedPricelistId?: unknown;
    productFingerprint?: unknown;
    prices?: unknown;
  };
  if (
    typeof candidate.resolvedPricelistId !== 'number'
    || !Number.isInteger(candidate.resolvedPricelistId)
    || candidate.resolvedPricelistId <= 0
    || typeof candidate.productFingerprint !== 'string'
    || !Array.isArray(candidate.prices)
  ) {
    return false;
  }

  const productIds: number[] = [];
  let previousProductId = 0;
  for (const price of candidate.prices) {
    if (
      !Array.isArray(price)
      || price.length !== 2
      || typeof price[0] !== 'number'
      || !Number.isInteger(price[0])
      || price[0] <= previousProductId
      || typeof price[1] !== 'number'
      || !Number.isFinite(price[1])
      || price[1] < 0
    ) {
      return false;
    }
    productIds.push(price[0]);
    previousProductId = price[0];
  }

  return (
    candidate.productFingerprint === productIds.join(',')
    && (
      expectedProductFingerprint === undefined
      || candidate.productFingerprint === expectedProductFingerprint
    )
  );
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : 'Error desconocido';
}

export async function settleRoutePricingTargets(
  input: SettleRoutePricingTargetsInput,
): Promise<SettledRoutePricingPreparation> {
  const nowMs = input.nowMs ?? Date.now;
  const settledTargets: Array<
    ActivatePreparedPricingTargetInput | undefined
  > = new Array(input.targets.length);
  const failures: Array<PreparationFailure | undefined> = new Array(
    input.targets.length,
  );
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < input.targets.length) {
      const index = cursor;
      cursor += 1;
      const target = input.targets[index]!;

      try {
        const validation = await input.fetchTarget(target);
        if (
          !isCompleteValidatedPricingSnapshot(
            validation,
            input.expectedProductFingerprint,
          )
        ) {
          failures[index] = {
            ...target,
            reason: INVALID_PRICING_RESPONSE_REASON,
          };
          settledTargets[index] = {
            ...target,
            status: 'failed',
          };
          continue;
        }

        settledTargets[index] = {
          ...target,
          status: 'prepared',
          snapshot: {
            preparedAtMs: nowMs(),
            validation,
          },
        };
      } catch (error) {
        failures[index] = {
          ...target,
          reason: failureReason(error),
        };
        settledTargets[index] = {
          ...target,
          status: 'failed',
        };
      }
    }
  }

  const requestedConcurrency = Number.isInteger(input.concurrency)
    ? input.concurrency!
    : MAX_ROUTE_PRICING_CONCURRENCY;
  const workerCount = Math.min(
    MAX_ROUTE_PRICING_CONCURRENCY,
    Math.max(1, requestedConcurrency),
    Math.max(1, input.targets.length),
  );
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  const targets = settledTargets.map((target) => target!);
  return {
    activationInput: {
      companyId: input.companyId,
      planId: input.planId,
      preparationRunId: input.preparationRunId,
      activatedAtMs: nowMs(),
      targets,
    },
    failures: failures.filter(
      (failure): failure is PreparationFailure => failure !== undefined,
    ),
    preparedCount: targets.filter((target) => target.status === 'prepared')
      .length,
    pricesPrepared: targets.reduce(
      (total, target) =>
        total + (
          target.status === 'prepared'
            ? target.snapshot.validation.prices.length
            : 0
        ),
      0,
    ),
  };
}

export async function prepareRoutePricingTargets(
  input: PrepareRoutePricingTargetsInput,
): Promise<SettledRoutePricingPreparation> {
  const settled = await settleRoutePricingTargets(input);
  const activateRun = input.activateRun ?? activatePreparedPricingRun;
  const publishedState = await input.updateState((current) =>
    activateRun(current, settled.activationInput)
  );
  const manifest = publishedState.activeManifest;
  const publishedTargets = new Map(
    manifest
    && manifest.companyId === input.companyId
    && manifest.planId === input.planId
    && manifest.preparationRunId === input.preparationRunId
      ? manifest.targets.map((target) => [
          `${target.partnerId}:${target.requestedPricelistId ?? 'null'}`,
          target,
        ])
      : [],
  );
  const settledFailures = new Map(
    settled.failures.map((failure) => [
      `${failure.partnerId}:${failure.requestedPricelistId ?? 'null'}`,
      failure,
    ]),
  );
  const failures: PreparationFailure[] = [];
  let preparedCount = 0;
  let pricesPrepared = 0;

  for (const target of settled.activationInput.targets) {
    const key = `${target.partnerId}:${target.requestedPricelistId ?? 'null'}`;
    const existingFailure = settledFailures.get(key);
    if (existingFailure) {
      failures.push(existingFailure);
      continue;
    }

    if (target.status === 'prepared' && publishedTargets.get(key)?.status === 'prepared') {
      preparedCount += 1;
      pricesPrepared += target.snapshot.validation.prices.length;
      continue;
    }

    failures.push({
      partnerId: target.partnerId,
      requestedPricelistId: target.requestedPricelistId,
      reason: STALE_PREPARATION_REASON,
    });
  }

  return {
    ...settled,
    failures,
    preparedCount,
    pricesPrepared,
  };
}

/**
 * Deduplicate partner ids from a list of stops, dropping invalid ids
 * (null, undefined, non-positive). Order is preserved by first occurrence
 * so the preload pulls clients in roughly route order.
 */
export function dedupePartnerIds(stops: PartnerLike[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const stop of stops) {
    const id = stop?.customer_id;
    if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Build a quick lookup from partner id → customer name so failure entries
 * can carry a human-readable label.
 */
export function buildCustomerNameMap(stops: PartnerLike[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const stop of stops) {
    if (typeof stop?.customer_id === 'number' && stop.customer_id > 0 && stop.customer_name) {
      if (!map.has(stop.customer_id)) {
        map.set(stop.customer_id, stop.customer_name);
      }
    }
  }
  return map;
}

/**
 * Decide whether the route is "freshly prepared" relative to the current
 * plan id. Returns true when the last preparation was for the same plan.
 * Used by the UI to switch the card to its "ready" state without leaking
 * stale preparations across plans (eg. when a Jefe de Ruta pushes a new
 * plan mid-day).
 */
export function isPreparationFreshForPlan(
  preparedPlanId: number | null,
  currentPlanId: number | null | undefined,
): boolean {
  if (preparedPlanId === null) return false;
  if (currentPlanId === null || currentPlanId === undefined) return false;
  return preparedPlanId === currentPlanId;
}

/**
 * Format a unix-ms timestamp as "HH:mm" 24h. Returns "" for null.
 * Pure / locale-independent so tests don't depend on the runtime tz.
 */
export function formatPreparedAt(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
