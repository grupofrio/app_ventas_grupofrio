import {
  STORAGE_KEYS,
  storeLoad,
  storeSaveStrict,
} from '../persistence/storage.ts';
import {
  compactPricingSnapshotState,
  emptyPricingSnapshotState,
  type LastKnownCustomerProductPrice,
  type PreparedCustomerPricingSnapshot,
  type PricingPreparationManifest,
  type PricingPreparationTarget,
  type PricingSnapshotStateV1,
  type ResolvedPricelistMapping,
} from './customerPricingSnapshot.ts';

export interface PricingSnapshotStorage {
  load(): Promise<unknown>;
  saveStrict(state: PricingSnapshotStateV1): Promise<void>;
}

type UnknownRecord = Record<string, unknown>;

const STATE_KEYS = [
  'version',
  'activeManifest',
  'snapshots',
  'requestedMappings',
  'lastKnownPrices',
] as const;
const MANIFEST_KEYS = [
  'version',
  'companyId',
  'planId',
  'preparationRunId',
  'activatedAtMs',
  'targets',
] as const;
const TARGET_KEYS = [
  'partnerId',
  'requestedPricelistId',
  'resolvedPricelistId',
  'snapshotId',
  'status',
] as const;
const SNAPSHOT_KEYS = [
  'version',
  'snapshotId',
  'companyId',
  'partnerId',
  'resolvedPricelistId',
  'preparedAtMs',
  'preparedPlanId',
  'preparationRunId',
  'origin',
  'productFingerprint',
  'prices',
] as const;
const MAPPING_KEYS = [
  'companyId',
  'partnerId',
  'requestedPricelistId',
  'resolvedPricelistId',
  'preparationRunId',
  'capturedAtMs',
] as const;
const LAST_KNOWN_PRICE_KEYS = [
  'productId',
  'unitPrice',
  'capturedAtMs',
  'preparationRunId',
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: UnknownRecord,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isPricingTarget(value: unknown): value is PricingPreparationTarget {
  if (!isRecord(value) || !hasOnlyKeys(value, TARGET_KEYS)) {
    return false;
  }
  if (
    !isPositiveInteger(value.partnerId)
    || !isNullablePositiveInteger(value.requestedPricelistId)
  ) {
    return false;
  }

  if (value.status === 'failed') {
    return value.resolvedPricelistId === null && value.snapshotId === null;
  }

  return (
    value.status === 'prepared'
    && isPositiveInteger(value.resolvedPricelistId)
    && isString(value.snapshotId)
    && value.snapshotId.length > 0
  );
}

function isPricingManifest(
  value: unknown,
): value is PricingPreparationManifest {
  return (
    isRecord(value)
    && hasOnlyKeys(value, MANIFEST_KEYS)
    && value.version === 1
    && isPositiveInteger(value.companyId)
    && isNullablePositiveInteger(value.planId)
    && isString(value.preparationRunId)
    && isNonNegativeFiniteNumber(value.activatedAtMs)
    && Array.isArray(value.targets)
    && value.targets.every(isPricingTarget)
  );
}

function isPreparedSnapshot(
  value: unknown,
): value is PreparedCustomerPricingSnapshot {
  return (
    isRecord(value)
    && hasOnlyKeys(value, SNAPSHOT_KEYS)
    && value.version === 1
    && isString(value.snapshotId)
    && value.snapshotId.length > 0
    && isPositiveInteger(value.companyId)
    && isPositiveInteger(value.partnerId)
    && isPositiveInteger(value.resolvedPricelistId)
    && isNonNegativeFiniteNumber(value.preparedAtMs)
    && isNullablePositiveInteger(value.preparedPlanId)
    && isString(value.preparationRunId)
    && value.origin === 'odoo_server_full'
    && isString(value.productFingerprint)
    && Array.isArray(value.prices)
    && value.prices.every((price) =>
      Array.isArray(price)
      && price.length === 2
      && isPositiveInteger(price[0])
      && isNonNegativeFiniteNumber(price[1])
    )
  );
}

function isRequestedMapping(
  value: unknown,
): value is ResolvedPricelistMapping {
  return (
    isRecord(value)
    && hasOnlyKeys(value, MAPPING_KEYS)
    && isPositiveInteger(value.companyId)
    && isPositiveInteger(value.partnerId)
    && isNullablePositiveInteger(value.requestedPricelistId)
    && isPositiveInteger(value.resolvedPricelistId)
    && isString(value.preparationRunId)
    && isNonNegativeFiniteNumber(value.capturedAtMs)
  );
}

function isLastKnownPrice(
  value: unknown,
): value is LastKnownCustomerProductPrice {
  return (
    isRecord(value)
    && hasOnlyKeys(value, LAST_KNOWN_PRICE_KEYS)
    && isPositiveInteger(value.productId)
    && isNonNegativeFiniteNumber(value.unitPrice)
    && isNonNegativeFiniteNumber(value.capturedAtMs)
    && isString(value.preparationRunId)
  );
}

function hasValidSnapshots(value: unknown): value is PricingSnapshotStateV1['snapshots'] {
  return (
    isRecord(value)
    && Object.entries(value).every(([snapshotId, snapshot]) =>
      isPreparedSnapshot(snapshot) && snapshot.snapshotId === snapshotId
    )
  );
}

function hasValidMappings(
  value: unknown,
): value is PricingSnapshotStateV1['requestedMappings'] {
  return (
    isRecord(value)
    && Object.entries(value).every(([mappingKey, mapping]) =>
      isRequestedMapping(mapping)
      && mappingKey === [
        mapping.companyId,
        mapping.partnerId,
        mapping.requestedPricelistId ?? 'null',
      ].join(':')
    )
  );
}

function hasValidLastKnownPrices(
  value: unknown,
): value is PricingSnapshotStateV1['lastKnownPrices'] {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).every(([canonicalKey, productPrices]) =>
    /^[1-9]\d*:[1-9]\d*:[1-9]\d*$/.test(canonicalKey)
    && isRecord(productPrices)
    && Object.entries(productPrices).every(([productId, price]) =>
      isLastKnownPrice(price) && String(price.productId) === productId
    )
  );
}

function isPricingSnapshotStateV1(
  value: unknown,
): value is PricingSnapshotStateV1 {
  if (!isRecord(value) || !hasOnlyKeys(value, STATE_KEYS)) {
    return false;
  }

  const activeManifest = value.activeManifest;
  const snapshots = value.snapshots;
  const requestedMappings = value.requestedMappings;
  const lastKnownPrices = value.lastKnownPrices;
  if (
    value.version !== 1
    || !(activeManifest === null || isPricingManifest(activeManifest))
    || !hasValidSnapshots(snapshots)
    || !hasValidMappings(requestedMappings)
    || !hasValidLastKnownPrices(lastKnownPrices)
  ) {
    return false;
  }

  if (!activeManifest) {
    return true;
  }

  return activeManifest.targets.every((target) => {
    if (target.status !== 'prepared' || !target.snapshotId) {
      return true;
    }

    const snapshot = snapshots[target.snapshotId];
    return (
      snapshot !== undefined
      && snapshot.companyId === activeManifest.companyId
      && snapshot.partnerId === target.partnerId
      && snapshot.resolvedPricelistId === target.resolvedPricelistId
      && snapshot.preparedPlanId === activeManifest.planId
      && snapshot.preparationRunId === activeManifest.preparationRunId
    );
  });
}

function compactValidState(value: unknown): PricingSnapshotStateV1 | null {
  if (!isPricingSnapshotStateV1(value)) {
    return null;
  }
  return compactPricingSnapshotState(value);
}

export class CustomerPricingSnapshotRepository {
  private publishedState = emptyPricingSnapshotState();
  private operationTail: Promise<void> = Promise.resolve();
  private readonly storage: PricingSnapshotStorage;

  constructor(storage: PricingSnapshotStorage) {
    this.storage = storage;
  }

  getState(): PricingSnapshotStateV1 {
    return this.publishedState;
  }

  hydrate(): Promise<PricingSnapshotStateV1> {
    return this.serialize(async () => {
      let hydrated = emptyPricingSnapshotState();
      try {
        hydrated = compactValidState(await this.storage.load())
          ?? emptyPricingSnapshotState();
      } catch {
        hydrated = emptyPricingSnapshotState();
      }
      this.publishedState = hydrated;
      return hydrated;
    });
  }

  replace(next: PricingSnapshotStateV1): Promise<void> {
    return this.serialize(async () => {
      const candidate = compactValidState(next);
      if (!candidate) {
        throw new TypeError('Invalid customer pricing snapshot state');
      }

      await this.storage.saveStrict(candidate);
      this.publishedState = candidate;
    });
  }

  update(
    updater: (
      current: PricingSnapshotStateV1,
    ) => PricingSnapshotStateV1,
  ): Promise<PricingSnapshotStateV1> {
    return this.serialize(async () => {
      const candidate = compactValidState(updater(this.publishedState));
      if (!candidate) {
        throw new TypeError('Invalid customer pricing snapshot state');
      }

      await this.storage.saveStrict(candidate);
      this.publishedState = candidate;
      return candidate;
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function createCustomerPricingSnapshotRepository(
  storage: PricingSnapshotStorage,
): CustomerPricingSnapshotRepository {
  return new CustomerPricingSnapshotRepository(storage);
}

const applicationRepository = createCustomerPricingSnapshotRepository({
  load: () =>
    storeLoad<unknown>(STORAGE_KEYS.CUSTOMER_PRICING_SNAPSHOTS),
  saveStrict: (state) =>
    storeSaveStrict(STORAGE_KEYS.CUSTOMER_PRICING_SNAPSHOTS, state),
});

export async function hydrateCustomerPricingSnapshots(): Promise<PricingSnapshotStateV1> {
  return applicationRepository.hydrate();
}

export function getCustomerPricingSnapshotState(): PricingSnapshotStateV1 {
  return applicationRepository.getState();
}

export async function replaceCustomerPricingSnapshotState(
  next: PricingSnapshotStateV1,
): Promise<void> {
  await applicationRepository.replace(next);
}

export async function updateCustomerPricingSnapshotState(
  updater: (
    current: PricingSnapshotStateV1,
  ) => PricingSnapshotStateV1,
): Promise<PricingSnapshotStateV1> {
  return applicationRepository.update(updater);
}
