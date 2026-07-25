export interface RoutePricingTarget {
  readonly partnerId: number;
  readonly requestedPricelistId: number | null;
}

export interface RoutePricingStopLike {
  readonly customer_id?: unknown;
  readonly _pricelistId?: unknown;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function buildRoutePricingTargets(
  stops: readonly RoutePricingStopLike[],
): RoutePricingTarget[] {
  const targets: RoutePricingTarget[] = [];
  const seen = new Set<string>();

  for (const stop of stops) {
    const partnerId = stop?.customer_id;
    const requestedPricelistId = stop?._pricelistId === undefined
      ? null
      : stop._pricelistId;
    if (!isPositiveInteger(partnerId)) {
      continue;
    }
    if (
      requestedPricelistId !== null
      && !isPositiveInteger(requestedPricelistId)
    ) {
      continue;
    }

    const key = `${partnerId}:${requestedPricelistId ?? 'null'}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push({ partnerId, requestedPricelistId });
  }

  return targets;
}
