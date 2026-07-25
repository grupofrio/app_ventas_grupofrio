export interface ServerCustomerProductPriceRow {
  readonly productId: number;
  readonly unitPrice: number;
}

export interface ValidateServerPriceSnapshotInput {
  readonly resolvedPricelistId: number | null;
  readonly requestedProductIds: readonly number[];
  readonly rows: readonly ServerCustomerProductPriceRow[];
}

export type CustomerProductPriceTuple = readonly [
  productId: number,
  unitPrice: number,
];

export interface ValidatedServerPriceSnapshot {
  readonly ok: true;
  readonly resolvedPricelistId: number;
  readonly productFingerprint: string;
  readonly prices: readonly CustomerProductPriceTuple[];
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
  readonly version: 1;
  readonly snapshotId: string;
  readonly companyId: number;
  readonly partnerId: number;
  readonly resolvedPricelistId: number;
  readonly preparedAtMs: number;
  readonly preparedPlanId: number | null;
  readonly preparationRunId: string;
  readonly origin: 'odoo_server_full';
  readonly productFingerprint: string;
  readonly prices: readonly CustomerProductPriceTuple[];
}

export interface LastKnownCustomerProductPrice {
  readonly productId: number;
  readonly unitPrice: number;
  readonly capturedAtMs: number;
  readonly preparationRunId: string;
}

export interface ResolvedPricelistMapping {
  readonly companyId: number;
  readonly partnerId: number;
  readonly requestedPricelistId: number | null;
  readonly resolvedPricelistId: number;
  readonly preparationRunId: string;
  readonly capturedAtMs: number;
}

export interface PricingPreparationTarget {
  readonly partnerId: number;
  readonly requestedPricelistId: number | null;
  readonly resolvedPricelistId: number | null;
  readonly snapshotId: string | null;
  readonly status: 'prepared' | 'failed';
}

export interface PricingPreparationManifest {
  readonly version: 1;
  readonly companyId: number;
  readonly planId: number | null;
  readonly preparationRunId: string;
  readonly activatedAtMs: number;
  readonly targets: readonly PricingPreparationTarget[];
}

export interface PricingSnapshotStateV1 {
  readonly version: 1;
  readonly activeManifest: PricingPreparationManifest | null;
  readonly snapshots: Readonly<Record<string, PreparedCustomerPricingSnapshot>>;
  readonly requestedMappings: Readonly<Record<string, ResolvedPricelistMapping>>;
  readonly lastKnownPrices: Readonly<Record<
    string,
    Readonly<Record<string, LastKnownCustomerProductPrice>>
  >>;
}

export interface NewPreparedPricingTargetInput {
  readonly status: 'prepared';
  readonly partnerId: number;
  readonly requestedPricelistId: number | null;
  readonly snapshot: {
    readonly preparedAtMs: number;
    readonly validation: ValidatedServerPriceSnapshot;
  };
}

export interface FailedPreparedPricingTargetInput {
  readonly status: 'failed';
  readonly partnerId: number;
  readonly requestedPricelistId: number | null;
}

export type ActivatePreparedPricingTargetInput =
  | NewPreparedPricingTargetInput
  | FailedPreparedPricingTargetInput;

export interface ActivatePreparedPricingRunInput {
  readonly companyId: number;
  readonly planId: number | null;
  readonly preparationRunId: string;
  readonly activatedAtMs: number;
  readonly targets: readonly ActivatePreparedPricingTargetInput[];
}

export interface RecordLastKnownServerPricesInput {
  readonly companyId: number;
  readonly partnerId: number;
  readonly requestedPricelistId: number | null;
  readonly capturedAtMs: number;
  readonly captureRunId: string;
  readonly validation: ValidatedServerPriceSnapshot;
}

export interface ResolveCapturedCustomerPriceInput {
  readonly companyId: number;
  readonly planId: number | null;
  readonly partnerId: number;
  readonly requestedPricelistId: number | null;
  readonly productId: number;
  readonly publicPrice: number;
}

export interface CapturedCustomerPrice {
  readonly unitPrice: number;
  readonly source:
    | 'prepared_customer'
    | 'last_known_customer'
    | 'public_fallback';
  readonly capturedAtMs: number | null;
  readonly pricelistId: number | null;
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

function freezePricingSnapshotState(
  source: PricingSnapshotStateV1,
): PricingSnapshotStateV1 {
  const snapshots: Record<string, PreparedCustomerPricingSnapshot> = {};
  for (const [snapshotId, snapshot] of Object.entries(source.snapshots)) {
    const prices = Object.freeze(
      snapshot.prices.map(
        ([productId, unitPrice]) =>
          Object.freeze([productId, unitPrice] as const),
      ),
    );
    snapshots[snapshotId] = Object.freeze({
      ...snapshot,
      prices,
    });
  }

  const requestedMappings: Record<string, ResolvedPricelistMapping> = {};
  for (const [mappingKey, mapping] of Object.entries(source.requestedMappings)) {
    requestedMappings[mappingKey] = Object.freeze({ ...mapping });
  }

  const lastKnownPrices: Record<
    string,
    Readonly<Record<string, LastKnownCustomerProductPrice>>
  > = {};
  for (const [canonicalKey, productPrices] of Object.entries(
    source.lastKnownPrices,
  )) {
    const frozenProductPrices: Record<
      string,
      LastKnownCustomerProductPrice
    > = {};
    for (const [productId, price] of Object.entries(productPrices)) {
      frozenProductPrices[productId] = Object.freeze({ ...price });
    }
    lastKnownPrices[canonicalKey] = Object.freeze(frozenProductPrices);
  }

  const activeManifest = source.activeManifest
    ? Object.freeze({
        ...source.activeManifest,
        targets: Object.freeze(
          source.activeManifest.targets.map(
            (target) => Object.freeze({ ...target }),
          ),
        ),
      })
    : null;

  return Object.freeze({
    version: 1,
    activeManifest,
    snapshots: Object.freeze(snapshots),
    requestedMappings: Object.freeze(requestedMappings),
    lastKnownPrices: Object.freeze(lastKnownPrices),
  });
}

function withLastKnownPrices(
  current: PricingSnapshotStateV1['lastKnownPrices'],
  input: {
    companyId: number;
    partnerId: number;
    resolvedPricelistId: number;
    capturedAtMs: number;
    preparationRunId: string;
    prices: readonly CustomerProductPriceTuple[];
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
  return freezePricingSnapshotState({
    version: 1,
    activeManifest: null,
    snapshots: {},
    requestedMappings: {},
    lastKnownPrices: {},
  });
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

  const prices: CustomerProductPriceTuple[] = [];
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
        capturedAtMs: input.activatedAtMs,
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

  return freezePricingSnapshotState({
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
  });
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
  const existingMapping = current.requestedMappings[mappingKey];
  const requestedMappings = (
    existingMapping
    && existingMapping.capturedAtMs >= input.capturedAtMs
  )
    ? current.requestedMappings
    : {
        ...current.requestedMappings,
        [mappingKey]: {
          companyId: input.companyId,
          partnerId: input.partnerId,
          requestedPricelistId: input.requestedPricelistId,
          resolvedPricelistId: input.validation.resolvedPricelistId,
          preparationRunId: input.captureRunId,
          capturedAtMs: input.capturedAtMs,
        },
      };

  return freezePricingSnapshotState({
    ...current,
    requestedMappings,
    lastKnownPrices: withLastKnownPrices(current.lastKnownPrices, {
      companyId: input.companyId,
      partnerId: input.partnerId,
      resolvedPricelistId: input.validation.resolvedPricelistId,
      capturedAtMs: input.capturedAtMs,
      preparationRunId: input.captureRunId,
      prices: input.validation.prices,
    }),
  });
}

export function compactPricingSnapshotState(
  current: PricingSnapshotStateV1,
): PricingSnapshotStateV1 {
  const referencedSnapshotIds = new Set(
    current.activeManifest?.targets.flatMap((target) =>
      target.status === 'prepared' && target.snapshotId
        ? [target.snapshotId]
        : [],
    ) ?? [],
  );
  const snapshots: Record<string, PreparedCustomerPricingSnapshot> = {};

  for (const snapshotId of referencedSnapshotIds) {
    const snapshot = current.snapshots[snapshotId];
    if (snapshot) {
      snapshots[snapshotId] = snapshot;
    }
  }

  return freezePricingSnapshotState({
    ...current,
    snapshots,
  });
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
