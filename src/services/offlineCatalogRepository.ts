import {
  STORAGE_KEYS,
  storeLoadStrict,
  storeSaveStrict,
} from '../persistence/storage.ts';
import type {
  InventorySource,
  TruckProduct,
} from '../stores/useProductStore.ts';
import {
  upsertRecentProducts,
  type RecentProductSnapshot,
} from './recentProductIndex.ts';

export interface AuthSnapshot {
  employeeId: number | null;
  companyId: number | null;
  warehouseId: number | null;
  mobileLocationId: number | null;
}

export interface OfflineCatalogContext {
  employeeId: number | null;
  companyId: number | null;
  warehouseId: number | null;
  mobileLocationId: number | null;
}

export interface LastKnownCatalogSnapshot {
  version: 1;
  companyId: number;
  employeeId: number;
  warehouseId: number;
  mobileLocationId: number | null;
  fetchedAtMs: number;
  inventorySource: InventorySource | null;
  hasStockData: boolean | null;
  products: TruckProduct[];
}

export interface OfflineCatalogStorage {
  load(key: string): Promise<unknown>;
  saveStrict(key: string, value: unknown): Promise<void>;
}

export interface OfflineCatalogRepository {
  loadLastKnownCatalog(
    context: OfflineCatalogContext,
  ): Promise<LastKnownCatalogSnapshot | null>;
  saveLastKnownCatalogStrict(
    snapshot: LastKnownCatalogSnapshot,
  ): Promise<void>;
  loadRecentProducts(
    context: OfflineCatalogContext,
  ): Promise<RecentProductSnapshot[]>;
  saveRecentProductsStrict(
    context: OfflineCatalogContext,
    products: RecentProductSnapshot[],
  ): Promise<void>;
}

interface LastKnownCatalogStateV1 {
  version: 1;
  records: Record<string, LastKnownCatalogSnapshot>;
}

interface RecentProductsRecordV1 {
  version: 1;
  employeeId: number;
  companyId: number;
  warehouseId: number;
  mobileLocationId: number | null;
  products: RecentProductSnapshot[];
}

interface RecentProductsStateV1 {
  version: 1;
  records: Record<string, RecentProductsRecordV1>;
}

type UnknownRecord = Record<string, unknown>;

const LAST_KNOWN_STATE_KEYS = ['version', 'records'] as const;
const LAST_KNOWN_SNAPSHOT_KEYS = [
  'version',
  'companyId',
  'employeeId',
  'warehouseId',
  'mobileLocationId',
  'fetchedAtMs',
  'inventorySource',
  'hasStockData',
  'products',
] as const;
const RECENT_STATE_KEYS = ['version', 'records'] as const;
const RECENT_RECORD_KEYS = [
  'version',
  'companyId',
  'employeeId',
  'warehouseId',
  'mobileLocationId',
  'products',
] as const;
const RECENT_PRODUCT_KEYS = [
  'productId',
  'name',
  'defaultCode',
  'listPrice',
  'weight',
  'lastSeenAtMs',
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

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0;
}

function nonNegativeSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function nonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0;
}

function nullablePositiveSafeInteger(
  value: unknown,
): value is number | null {
  return value === null || positiveSafeInteger(value);
}

function safeIdOrNull(value: unknown): number | null {
  return positiveSafeInteger(value) ? value : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMany2one(value: unknown): value is [number, string] | false {
  return value === false
    || (
      Array.isArray(value)
      && value.length === 2
      && positiveSafeInteger(value[0])
      && typeof value[1] === 'string'
    );
}

function isOptionalMany2one(
  value: unknown,
): value is [number, string] | false | undefined {
  return value === undefined || isMany2one(value);
}

function isInventorySource(
  value: unknown,
): value is InventorySource | null {
  return value === null
    || value === 'truck_stock'
    || value === 'stock_quant'
    || value === 'global_legacy';
}

function sanitizeTruckProduct(value: unknown): TruckProduct | null {
  if (
    !isRecord(value)
    || !positiveSafeInteger(value.id)
    || !isNonEmptyString(value.name)
    || (
      value.default_code !== undefined
      && value.default_code !== false
      && typeof value.default_code !== 'string'
    )
    || !nonNegativeFiniteNumber(value.list_price)
    || !nonNegativeFiniteNumber(value.qty_available)
    || typeof value.sale_ok !== 'boolean'
    || !isMany2one(value.product_tmpl_id)
    || (
      value.weight !== undefined
      && !nonNegativeFiniteNumber(value.weight)
    )
    || !isOptionalMany2one(value.categ_id)
    || (
      value.image_128 !== undefined
      && value.image_128 !== false
      && typeof value.image_128 !== 'string'
    )
    || !nonNegativeFiniteNumber(value._totalKg)
    || !nonNegativeFiniteNumber(value.qty_reserved)
    || !nonNegativeFiniteNumber(value.qty_display)
    || typeof value._isGlobalFallback !== 'boolean'
  ) {
    return null;
  }

  const defaultCode = typeof value.default_code === 'string'
    ? value.default_code.trim()
    : '';

  return {
    id: value.id,
    name: value.name.trim(),
    ...(defaultCode.length > 0 ? { default_code: defaultCode } : {}),
    list_price: value.list_price,
    qty_available: value.qty_available,
    sale_ok: value.sale_ok,
    product_tmpl_id: value.product_tmpl_id === false
      ? false
      : [...value.product_tmpl_id],
    ...(value.weight === undefined ? {} : { weight: value.weight }),
    ...(value.categ_id === undefined
      ? {}
      : {
          categ_id: value.categ_id === false
            ? false
            : [...value.categ_id],
        }),
    ...(value.image_128 === undefined ? {} : { image_128: value.image_128 }),
    _totalKg: value._totalKg,
    qty_reserved: value.qty_reserved,
    qty_display: value.qty_display,
    _isGlobalFallback: value._isGlobalFallback,
  };
}

function isRecentProductSnapshot(
  value: unknown,
): value is RecentProductSnapshot {
  return (
    isRecord(value)
    && hasOnlyKeys(value, RECENT_PRODUCT_KEYS)
    && positiveSafeInteger(value.productId)
    && isNonEmptyString(value.name)
    && (
      value.defaultCode === null
      || typeof value.defaultCode === 'string'
    )
    && nonNegativeFiniteNumber(value.listPrice)
    && nonNegativeFiniteNumber(value.weight)
    && nonNegativeSafeTimestamp(value.lastSeenAtMs)
  );
}

function parseLastKnownCatalogSnapshot(
  value: unknown,
): LastKnownCatalogSnapshot | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, LAST_KNOWN_SNAPSHOT_KEYS)
    || value.version !== 1
    || !positiveSafeInteger(value.companyId)
    || !positiveSafeInteger(value.employeeId)
    || !positiveSafeInteger(value.warehouseId)
    || !nullablePositiveSafeInteger(value.mobileLocationId)
    || !nonNegativeSafeTimestamp(value.fetchedAtMs)
    || !isInventorySource(value.inventorySource)
    || (
      value.hasStockData !== null
      && typeof value.hasStockData !== 'boolean'
    )
    || !Array.isArray(value.products)
    || value.products.length === 0
  ) {
    return null;
  }

  const products: TruckProduct[] = [];
  const ids = new Set<number>();
  for (const candidate of value.products) {
    const product = sanitizeTruckProduct(candidate);
    if (!product) return null;
    if (ids.has(product.id)) return null;
    ids.add(product.id);
    products.push(product);
  }

  return {
    version: 1,
    companyId: value.companyId,
    employeeId: value.employeeId,
    warehouseId: value.warehouseId,
    mobileLocationId: value.mobileLocationId,
    fetchedAtMs: value.fetchedAtMs,
    inventorySource: value.inventorySource,
    hasStockData: value.hasStockData,
    products,
  };
}

function parseLastKnownState(value: unknown): LastKnownCatalogStateV1 | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, LAST_KNOWN_STATE_KEYS)
    || value.version !== 1
    || !isRecord(value.records)
  ) {
    return null;
  }

  const records: Record<string, LastKnownCatalogSnapshot> = {};
  for (const [identity, candidate] of Object.entries(value.records)) {
    const parsed = parseLastKnownCatalogSnapshot(candidate);
    if (
      parsed
      && buildOfflineCatalogContextIdentity(parsed) === identity
    ) {
      records[identity] = parsed;
    }
  }
  return { version: 1, records };
}

function parseRecentProducts(
  value: unknown,
): RecentProductSnapshot[] | null {
  if (
    !Array.isArray(value)
    || !value.every(isRecentProductSnapshot)
  ) {
    return null;
  }
  return upsertRecentProducts([], value);
}

function parseRecentRecord(value: unknown): RecentProductsRecordV1 | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, RECENT_RECORD_KEYS)
    || value.version !== 1
    || !positiveSafeInteger(value.companyId)
    || !positiveSafeInteger(value.employeeId)
    || !positiveSafeInteger(value.warehouseId)
    || !nullablePositiveSafeInteger(value.mobileLocationId)
  ) {
    return null;
  }
  const products = parseRecentProducts(value.products);
  if (!products) return null;
  return {
    version: 1,
    employeeId: value.employeeId,
    companyId: value.companyId,
    warehouseId: value.warehouseId,
    mobileLocationId: value.mobileLocationId,
    products,
  };
}

function parseRecentState(value: unknown): RecentProductsStateV1 | null {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, RECENT_STATE_KEYS)
    || value.version !== 1
    || !isRecord(value.records)
  ) {
    return null;
  }

  const records: Record<string, RecentProductsRecordV1> = {};
  for (const [identity, candidate] of Object.entries(value.records)) {
    const parsed = parseRecentRecord(candidate);
    if (
      parsed
      && buildOfflineCatalogContextIdentity(parsed) === identity
    ) {
      records[identity] = parsed;
    }
  }
  return { version: 1, records };
}

function validPersistenceContext(
  context: OfflineCatalogContext,
): context is OfflineCatalogContext & {
  employeeId: number;
  companyId: number;
  warehouseId: number;
} {
  return positiveSafeInteger(context.employeeId)
    && positiveSafeInteger(context.companyId)
    && positiveSafeInteger(context.warehouseId)
    && nullablePositiveSafeInteger(context.mobileLocationId);
}

export function buildOfflineCatalogContext(
  auth: AuthSnapshot,
): OfflineCatalogContext {
  const candidate: UnknownRecord = isRecord(auth) ? auth : {};
  return {
    employeeId: safeIdOrNull(candidate.employeeId),
    companyId: safeIdOrNull(candidate.companyId),
    warehouseId: safeIdOrNull(candidate.warehouseId),
    mobileLocationId: safeIdOrNull(candidate.mobileLocationId),
  };
}

/**
 * JSON's tuple boundaries keep this identity collision-safe without putting a
 * date in it. Field order is intentionally fixed and versioned by the storage
 * keys/state.
 */
export function buildOfflineCatalogContextIdentity(
  context: OfflineCatalogContext,
): string {
  return JSON.stringify([
    context.employeeId,
    context.companyId,
    context.warehouseId,
    context.mobileLocationId,
  ]);
}

function contextFromSnapshot(
  snapshot: LastKnownCatalogSnapshot,
): OfflineCatalogContext {
  return {
    employeeId: snapshot.employeeId,
    companyId: snapshot.companyId,
    warehouseId: snapshot.warehouseId,
    mobileLocationId: snapshot.mobileLocationId,
  };
}

function cloneRecentProducts(
  products: readonly RecentProductSnapshot[],
): RecentProductSnapshot[] {
  return products.map((product) => ({ ...product }));
}

export function createOfflineCatalogRepository(
  storage: OfflineCatalogStorage,
): OfflineCatalogRepository {
  let pendingWrite: Promise<void> = Promise.resolve();

  const serializeWrite = (write: () => Promise<void>): Promise<void> => {
    const result = pendingWrite.then(write, write);
    pendingWrite = result.catch(() => undefined);
    return result;
  };

  return {
    loadLastKnownCatalog: async (context) => {
      if (!validPersistenceContext(context)) return null;
      try {
        const raw = await storage.load(STORAGE_KEYS.LAST_KNOWN_CATALOG);
        const state = parseLastKnownState(raw);
        if (!state) return null;
        const snapshot = state.records[
          buildOfflineCatalogContextIdentity(context)
        ];
        return snapshot
          ? parseLastKnownCatalogSnapshot(snapshot)
          : null;
      } catch {
        return null;
      }
    },

    saveLastKnownCatalogStrict: async (snapshot) => {
      const parsed = parseLastKnownCatalogSnapshot(snapshot);
      if (!parsed) {
        throw new TypeError('Invalid last-known catalog snapshot');
      }
      const context = contextFromSnapshot(parsed);
      const identity = buildOfflineCatalogContextIdentity(context);

      return serializeWrite(async () => {
        const raw = await storage.load(STORAGE_KEYS.LAST_KNOWN_CATALOG);
        const previous = raw === null ? null : parseLastKnownState(raw);
        if (raw !== null && !previous) {
          throw new TypeError('Invalid last-known catalog repository state');
        }
        await storage.saveStrict(STORAGE_KEYS.LAST_KNOWN_CATALOG, {
          version: 1,
          records: {
            ...(previous?.records ?? {}),
            [identity]: parsed,
          },
        } satisfies LastKnownCatalogStateV1);
      });
    },

    loadRecentProducts: async (context) => {
      if (!validPersistenceContext(context)) return [];
      try {
        const raw = await storage.load(STORAGE_KEYS.RECENT_PRODUCTS);
        const state = parseRecentState(raw);
        if (!state) return [];
        const record = state.records[
          buildOfflineCatalogContextIdentity(context)
        ];
        return record ? cloneRecentProducts(record.products) : [];
      } catch {
        return [];
      }
    },

    saveRecentProductsStrict: async (context, products) => {
      if (!validPersistenceContext(context)) {
        throw new TypeError('Invalid offline catalog context');
      }
      if (!Array.isArray(products) || !products.every(isRecentProductSnapshot)) {
        throw new TypeError('Invalid recent product snapshot');
      }
      const normalizedProducts = upsertRecentProducts([], products);
      const identity = buildOfflineCatalogContextIdentity(context);
      const record: RecentProductsRecordV1 = {
        version: 1,
        employeeId: context.employeeId,
        companyId: context.companyId,
        warehouseId: context.warehouseId,
        mobileLocationId: context.mobileLocationId,
        products: cloneRecentProducts(normalizedProducts),
      };

      return serializeWrite(async () => {
        const raw = await storage.load(STORAGE_KEYS.RECENT_PRODUCTS);
        const previous = raw === null ? null : parseRecentState(raw);
        if (raw !== null && !previous) {
          throw new TypeError('Invalid recent products repository state');
        }
        await storage.saveStrict(STORAGE_KEYS.RECENT_PRODUCTS, {
          version: 1,
          records: {
            ...(previous?.records ?? {}),
            [identity]: record,
          },
        } satisfies RecentProductsStateV1);
      });
    },
  };
}

const applicationRepository = createOfflineCatalogRepository({
  load: (key) => storeLoadStrict<unknown>(key),
  saveStrict: (key, value) => storeSaveStrict(key, value),
});

export async function loadLastKnownCatalog(
  context: OfflineCatalogContext,
): Promise<LastKnownCatalogSnapshot | null> {
  return applicationRepository.loadLastKnownCatalog(context);
}

export async function saveLastKnownCatalogStrict(
  snapshot: LastKnownCatalogSnapshot,
): Promise<void> {
  return applicationRepository.saveLastKnownCatalogStrict(snapshot);
}

export async function loadRecentProducts(
  context: OfflineCatalogContext,
): Promise<RecentProductSnapshot[]> {
  return applicationRepository.loadRecentProducts(context);
}

export async function saveRecentProductsStrict(
  context: OfflineCatalogContext,
  products: RecentProductSnapshot[],
): Promise<void> {
  return applicationRepository.saveRecentProductsStrict(context, products);
}
