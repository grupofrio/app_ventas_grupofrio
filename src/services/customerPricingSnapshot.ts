export interface ServerCustomerProductPriceRow {
  productId: number;
  unitPrice: number;
}

export interface ValidateServerPriceSnapshotInput {
  resolvedPricelistId: number | null;
  requestedProductIds: number[];
  rows: ServerCustomerProductPriceRow[];
}

export interface ValidatedServerPriceSnapshot {
  ok: true;
  resolvedPricelistId: number;
  productFingerprint: string;
  prices: Array<[productId: number, unitPrice: number]>;
}

export type InvalidServerPriceSnapshot =
  | {
      ok: false;
      reason: 'invalid_resolved_pricelist';
    }
  | {
      ok: false;
      reason: 'invalid_requested_product';
      productId: number;
    }
  | {
      ok: false;
      reason: 'incomplete_product_coverage';
      missingProductIds: number[];
    }
  | {
      ok: false;
      reason: 'invalid_price';
      productId: number;
    }
  | {
      ok: false;
      reason: 'conflicting_product_rows';
      productId: number;
    };

export type ValidationResult =
  | ValidatedServerPriceSnapshot
  | InvalidServerPriceSnapshot;

export interface PreparedCustomerPricingSnapshot {
  version: 1;
  snapshotId: string;
  companyId: number;
  partnerId: number;
  resolvedPricelistId: number;
  preparedAtMs: number;
  preparedPlanId: number | null;
  preparationRunId: string;
  origin: 'odoo_server_full';
  productFingerprint: string;
  prices: Array<[productId: number, unitPrice: number]>;
}

export interface LastKnownCustomerProductPrice {
  productId: number;
  unitPrice: number;
  capturedAtMs: number;
  preparationRunId: string;
}

export interface ResolvedPricelistMapping {
  companyId: number;
  partnerId: number;
  requestedPricelistId: number | null;
  resolvedPricelistId: number;
  preparationRunId: string;
}

export interface PricingPreparationTarget {
  partnerId: number;
  requestedPricelistId: number | null;
  resolvedPricelistId: number | null;
  snapshotId: string | null;
  status: 'prepared' | 'failed';
}

export interface PricingPreparationManifest {
  version: 1;
  companyId: number;
  planId: number | null;
  preparationRunId: string;
  activatedAtMs: number;
  targets: PricingPreparationTarget[];
}

export interface PricingSnapshotStateV1 {
  version: 1;
  activeManifest: PricingPreparationManifest | null;
  snapshots: Record<string, PreparedCustomerPricingSnapshot>;
  requestedMappings: Record<string, ResolvedPricelistMapping>;
  lastKnownPrices: Record<
    string,
    Record<string, LastKnownCustomerProductPrice>
  >;
}

export interface NewPreparedPricingTargetInput {
  status: 'prepared';
  partnerId: number;
  requestedPricelistId: number | null;
  snapshot: {
    preparedAtMs: number;
    validation: ValidatedServerPriceSnapshot;
  };
}

export interface FailedPreparedPricingTargetInput {
  status: 'failed';
  partnerId: number;
  requestedPricelistId: number | null;
}

export type ActivatePreparedPricingTargetInput =
  | NewPreparedPricingTargetInput
  | FailedPreparedPricingTargetInput;

export interface ActivatePreparedPricingRunInput {
  companyId: number;
  planId: number | null;
  preparationRunId: string;
  activatedAtMs: number;
  targets: ActivatePreparedPricingTargetInput[];
}

export interface RecordLastKnownServerPricesInput {
  companyId: number;
  partnerId: number;
  requestedPricelistId: number | null;
  capturedAtMs: number;
  captureRunId: string;
  validation: ValidatedServerPriceSnapshot;
}

export interface ResolveCapturedCustomerPriceInput {
  companyId: number;
  planId: number | null;
  partnerId: number;
  requestedPricelistId: number | null;
  productId: number;
  publicPrice: number;
}

export interface CapturedCustomerPrice {
  unitPrice: number;
  source:
    | 'prepared_customer'
    | 'last_known_customer'
    | 'public_fallback';
  capturedAtMs: number | null;
  pricelistId: number | null;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function requestedMappingKey(
  companyId: number,
  partnerId: number,
  requestedPricelistId: number | null,
): string {
  return `${companyId}:${partnerId}:${requestedPricelistId ?? 'null'}`;
}

function canonicalPricingKey(
  companyId: number,
  partnerId: number,
  resolvedPricelistId: number,
): string {
  return `${companyId}:${partnerId}:${resolvedPricelistId}`;
}

function snapshotIdFor(
  preparationRunId: string,
  companyId: number,
  partnerId: number,
  resolvedPricelistId: number,
): string {
  return `${preparationRunId}:${companyId}:${partnerId}:${resolvedPricelistId}`;
}

function hasSamePricePayload(
  left: PreparedCustomerPricingSnapshot,
  right: PreparedCustomerPricingSnapshot,
): boolean {
  return (
    left.productFingerprint === right.productFingerprint
    && left.prices.length === right.prices.length
    && left.prices.every(
      ([productId, unitPrice], index) =>
        productId === right.prices[index]?.[0]
        && unitPrice === right.prices[index]?.[1],
    )
  );
}

function withLastKnownPrices(
  current: PricingSnapshotStateV1['lastKnownPrices'],
  input: {
    companyId: number;
    partnerId: number;
    resolvedPricelistId: number;
    capturedAtMs: number;
    preparationRunId: string;
    prices: Array<[productId: number, unitPrice: number]>;
  },
): PricingSnapshotStateV1['lastKnownPrices'] {
  const canonicalKey = canonicalPricingKey(
    input.companyId,
    input.partnerId,
    input.resolvedPricelistId,
  );
  const nextProductPrices = { ...(current[canonicalKey] ?? {}) };

  for (const [productId, unitPrice] of input.prices) {
    const existing = nextProductPrices[String(productId)];
    if (existing && existing.capturedAtMs >= input.capturedAtMs) {
      continue;
    }

    nextProductPrices[String(productId)] = {
      productId,
      unitPrice,
      capturedAtMs: input.capturedAtMs,
      preparationRunId: input.preparationRunId,
    };
  }

  return {
    ...current,
    [canonicalKey]: nextProductPrices,
  };
}

export function emptyPricingSnapshotState(): PricingSnapshotStateV1 {
  return {
    version: 1,
    activeManifest: null,
    snapshots: {},
    requestedMappings: {},
    lastKnownPrices: {},
  };
}

export function validateServerPriceSnapshot(
  input: ValidateServerPriceSnapshotInput,
): ValidationResult {
  if (
    input.resolvedPricelistId === null
    || !isPositiveInteger(input.resolvedPricelistId)
  ) {
    return {
      ok: false,
      reason: 'invalid_resolved_pricelist',
    };
  }

  const requestedProductIds = [...new Set(input.requestedProductIds)].sort(
    (left, right) => left - right,
  );
  const invalidRequestedProductId = requestedProductIds.find(
    (productId) => !isPositiveInteger(productId),
  );

  if (invalidRequestedProductId !== undefined) {
    return {
      ok: false,
      reason: 'invalid_requested_product',
      productId: invalidRequestedProductId,
    };
  }

  const requestedSet = new Set(requestedProductIds);
  const acceptedRows = new Map<number, ServerCustomerProductPriceRow>();

  for (const row of input.rows) {
    if (!requestedSet.has(row.productId)) {
      continue;
    }

    const existingRow = acceptedRows.get(row.productId);
    if (existingRow) {
      if (
        !Number.isFinite(existingRow.unitPrice)
        || existingRow.unitPrice < 0
        || !Number.isFinite(row.unitPrice)
        || row.unitPrice < 0
      ) {
        return {
          ok: false,
          reason: 'invalid_price',
          productId: row.productId,
        };
      }
      if (existingRow.unitPrice !== row.unitPrice) {
        return {
          ok: false,
          reason: 'conflicting_product_rows',
          productId: row.productId,
        };
      }
      continue;
    }

    acceptedRows.set(row.productId, row);
  }

  const missingProductIds = requestedProductIds.filter(
    (productId) => !acceptedRows.has(productId),
  );

  if (missingProductIds.length > 0) {
    return {
      ok: false,
      reason: 'incomplete_product_coverage',
      missingProductIds,
    };
  }

  const prices: Array<[productId: number, unitPrice: number]> = [];
  for (const productId of requestedProductIds) {
    const unitPrice = acceptedRows.get(productId)!.unitPrice;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return {
        ok: false,
        reason: 'invalid_price',
        productId,
      };
    }
    prices.push([productId, unitPrice]);
  }

  return {
    ok: true,
    resolvedPricelistId: input.resolvedPricelistId,
    productFingerprint: requestedProductIds.join(','),
    prices,
  };
}

export function activatePreparedPricingRun(
  current: PricingSnapshotStateV1,
  input: ActivatePreparedPricingRunInput,
): PricingSnapshotStateV1 {
  let snapshots = current.snapshots;
  let requestedMappings = current.requestedMappings;
  let lastKnownPrices = current.lastKnownPrices;
  const manifestTargets: PricingPreparationTarget[] = [];

  for (const target of input.targets) {
    if (target.status === 'failed') {
      manifestTargets.push({
        partnerId: target.partnerId,
        requestedPricelistId: target.requestedPricelistId,
        resolvedPricelistId: null,
        snapshotId: null,
        status: 'failed',
      });
      continue;
    }

    const { validation } = target.snapshot;
    const snapshotId = snapshotIdFor(
      input.preparationRunId,
      input.companyId,
      target.partnerId,
      validation.resolvedPricelistId,
    );
    const snapshot: PreparedCustomerPricingSnapshot = {
      version: 1,
      snapshotId,
      companyId: input.companyId,
      partnerId: target.partnerId,
      resolvedPricelistId: validation.resolvedPricelistId,
      preparedAtMs: target.snapshot.preparedAtMs,
      preparedPlanId: input.planId,
      preparationRunId: input.preparationRunId,
      origin: 'odoo_server_full',
      productFingerprint: validation.productFingerprint,
      prices: validation.prices.map(([productId, unitPrice]) => [
        productId,
        unitPrice,
      ]),
    };
    const existingSnapshot = snapshots[snapshotId];

    if (
      existingSnapshot
      && (
        existingSnapshot.snapshotId !== snapshotId
        || existingSnapshot.companyId !== input.companyId
        || existingSnapshot.partnerId !== target.partnerId
        || existingSnapshot.resolvedPricelistId !== validation.resolvedPricelistId
        || existingSnapshot.preparedPlanId !== input.planId
        || existingSnapshot.preparationRunId !== input.preparationRunId
      )
    ) {
      throw new Error(`Pricing snapshot ID already exists: ${snapshotId}`);
    }
    if (existingSnapshot && !hasSamePricePayload(existingSnapshot, snapshot)) {
      throw new Error(
        `Conflicting pricing snapshot candidates: ${snapshotId}`,
      );
    }

    if (!existingSnapshot) {
      snapshots = {
        ...snapshots,
        [snapshotId]: snapshot,
      };
    } else if (
      !current.snapshots[snapshotId]
      && snapshot.preparedAtMs < existingSnapshot.preparedAtMs
    ) {
      snapshots = {
        ...snapshots,
        [snapshotId]: snapshot,
      };
    }

    const mappingKey = requestedMappingKey(
      input.companyId,
      target.partnerId,
      target.requestedPricelistId,
    );
    requestedMappings = {
      ...requestedMappings,
      [mappingKey]: {
        companyId: input.companyId,
        partnerId: target.partnerId,
        requestedPricelistId: target.requestedPricelistId,
        resolvedPricelistId: validation.resolvedPricelistId,
        preparationRunId: input.preparationRunId,
      },
    };
    lastKnownPrices = withLastKnownPrices(lastKnownPrices, {
      companyId: input.companyId,
      partnerId: target.partnerId,
      resolvedPricelistId: validation.resolvedPricelistId,
      capturedAtMs: target.snapshot.preparedAtMs,
      preparationRunId: input.preparationRunId,
      prices: validation.prices,
    });
    manifestTargets.push({
      partnerId: target.partnerId,
      requestedPricelistId: target.requestedPricelistId,
      resolvedPricelistId: validation.resolvedPricelistId,
      snapshotId,
      status: 'prepared',
    });
  }

  return {
    version: 1,
    activeManifest: {
      version: 1,
      companyId: input.companyId,
      planId: input.planId,
      preparationRunId: input.preparationRunId,
      activatedAtMs: input.activatedAtMs,
      targets: manifestTargets,
    },
    snapshots,
    requestedMappings,
    lastKnownPrices,
  };
}

export function recordLastKnownServerPrices(
  current: PricingSnapshotStateV1,
  input: RecordLastKnownServerPricesInput,
): PricingSnapshotStateV1 {
  const mappingKey = requestedMappingKey(
    input.companyId,
    input.partnerId,
    input.requestedPricelistId,
  );

  return {
    ...current,
    requestedMappings: {
      ...current.requestedMappings,
      [mappingKey]: {
        companyId: input.companyId,
        partnerId: input.partnerId,
        requestedPricelistId: input.requestedPricelistId,
        resolvedPricelistId: input.validation.resolvedPricelistId,
        preparationRunId: input.captureRunId,
      },
    },
    lastKnownPrices: withLastKnownPrices(current.lastKnownPrices, {
      companyId: input.companyId,
      partnerId: input.partnerId,
      resolvedPricelistId: input.validation.resolvedPricelistId,
      capturedAtMs: input.capturedAtMs,
      preparationRunId: input.captureRunId,
      prices: input.validation.prices,
    }),
  };
}

export function resolveCapturedCustomerPrice(
  current: PricingSnapshotStateV1,
  input: ResolveCapturedCustomerPriceInput,
): CapturedCustomerPrice {
  const fallback: CapturedCustomerPrice = {
    unitPrice: input.publicPrice,
    source: 'public_fallback',
    capturedAtMs: null,
    pricelistId: null,
  };
  const mapping = current.requestedMappings[
    requestedMappingKey(
      input.companyId,
      input.partnerId,
      input.requestedPricelistId,
    )
  ];

  if (
    !mapping
    || mapping.companyId !== input.companyId
    || mapping.partnerId !== input.partnerId
    || mapping.requestedPricelistId !== input.requestedPricelistId
    || !isPositiveInteger(mapping.resolvedPricelistId)
  ) {
    return fallback;
  }

  const canonicalPricelistId = mapping.resolvedPricelistId;
  const manifest = current.activeManifest;

  if (
    manifest
    && manifest.companyId === input.companyId
    && manifest.planId === input.planId
  ) {
    const preparedTarget = manifest.targets.find(
      (target) =>
        target.status === 'prepared'
        && target.partnerId === input.partnerId
        && target.requestedPricelistId === input.requestedPricelistId
        && target.resolvedPricelistId === canonicalPricelistId
        && typeof target.snapshotId === 'string',
    );
    const snapshot = preparedTarget?.snapshotId
      ? current.snapshots[preparedTarget.snapshotId]
      : undefined;

    if (
      snapshot
      && snapshot.version === 1
      && snapshot.origin === 'odoo_server_full'
      && snapshot.snapshotId === preparedTarget?.snapshotId
      && snapshot.companyId === input.companyId
      && snapshot.partnerId === input.partnerId
      && snapshot.resolvedPricelistId === canonicalPricelistId
      && snapshot.preparedPlanId === input.planId
      && snapshot.preparationRunId === manifest.preparationRunId
      && Number.isFinite(snapshot.preparedAtMs)
      && snapshot.preparedAtMs >= 0
    ) {
      const preparedPrice = snapshot.prices.find(
        ([productId]) => productId === input.productId,
      )?.[1];

      if (
        typeof preparedPrice === 'number'
        && Number.isFinite(preparedPrice)
        && preparedPrice >= 0
      ) {
        return {
          unitPrice: preparedPrice,
          source: 'prepared_customer',
          capturedAtMs: snapshot.preparedAtMs,
          pricelistId: canonicalPricelistId,
        };
      }
    }
  }

  const lastKnown = current.lastKnownPrices[
    canonicalPricingKey(
      input.companyId,
      input.partnerId,
      canonicalPricelistId,
    )
  ]?.[String(input.productId)];

  if (
    lastKnown
    && lastKnown.productId === input.productId
    && Number.isFinite(lastKnown.unitPrice)
    && lastKnown.unitPrice >= 0
    && Number.isFinite(lastKnown.capturedAtMs)
    && lastKnown.capturedAtMs >= 0
  ) {
    return {
      unitPrice: lastKnown.unitPrice,
      source: 'last_known_customer',
      capturedAtMs: lastKnown.capturedAtMs,
      pricelistId: canonicalPricelistId,
    };
  }

  return fallback;
}
