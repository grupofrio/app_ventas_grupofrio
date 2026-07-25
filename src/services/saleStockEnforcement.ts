import type { InventoryFreshness } from './effectiveOfflineCatalog.ts';
import type { ProductStockPolicy } from './productStockPolicy.ts';
import type { InventoryLoadResult } from './legacyRefreshRunner.ts';

export interface SaleStockEnforcementInput {
  isOnline: boolean | null | undefined;
  policy: ProductStockPolicy;
  inventoryFreshness: InventoryFreshness;
}

export interface SaleStockEnforcementDecision {
  allowConfirm: boolean;
  shouldRefresh: boolean;
  enforceFreshStock: boolean;
}

export interface SaleConfirmationContext {
  isAuthenticated: boolean;
  isOnline: boolean | null | undefined;
  employeeId: number | null;
  companyId: number | null;
  warehouseId: number | null;
  mobileLocationId: number | null;
  planId: number | null;
  stopId: number | null;
  partnerId: number | null;
  pricelistId: number | null;
  offrouteVisitId: number | null;
  activeVisitPhase: 'idle' | 'checked_in' | 'selling' | 'no_selling' | 'checked_out';
  activeVisitStopId: number | null;
  activeVisitCurrentStopId: number | null;
  activeVisitPartnerId: number | null;
}

export interface SaleInventoryAuthorityState {
  inventoryFreshness: InventoryFreshness;
  loadedWarehouseId: number | null;
  inventorySource: string | null;
}

export type SaleSubmissionPriceSource =
  | 'prepared_customer'
  | 'last_known_customer'
  | 'public_fallback';

export interface SaleSubmissionLineInput {
  productId: number;
  productName: string;
  price: number;
  priceSource?: SaleSubmissionPriceSource;
  priceCapturedAtMs?: number | null;
  pricelistId?: number | null;
  qty: number;
  stock: number | null;
  weight: number;
}

export interface SaleSubmissionInput {
  saleLines: SaleSubmissionLineInput[];
  salePaymentMethod: 'cash' | 'credit' | null;
  salePhotoTaken: boolean;
  salePhotoUri: string | null;
  salePhotoUris: string[];
}

export interface CapturedSaleSubmissionLine {
  readonly productId: number;
  readonly productName: string;
  readonly price: number;
  readonly priceSource: SaleSubmissionPriceSource | null;
  readonly priceCapturedAtMs: number | null;
  readonly pricelistId: number | null;
  readonly qty: number;
  readonly stock: number | null;
  readonly weight: number;
}

export interface CapturedSaleSubmissionInput {
  readonly saleLines: readonly CapturedSaleSubmissionLine[];
  readonly salePaymentMethod: 'cash' | 'credit' | null;
  readonly salePhotoTaken: boolean;
  readonly salePhotoUri: string | null;
  readonly salePhotoUris: readonly string[];
  readonly subtotal: number;
  readonly total: number;
  readonly totalKg: number;
  readonly fingerprint: string;
}

const BLOCKED_WITHOUT_AUTHORITY: SaleStockEnforcementDecision = {
  allowConfirm: false,
  shouldRefresh: false,
  enforceFreshStock: false,
};

function fingerprintNumber(value: number | null | undefined): number | string | null {
  if (value === null || value === undefined) return null;
  if (Number.isNaN(value)) return 'nan';
  if (value === Number.POSITIVE_INFINITY) return 'infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-infinity';
  if (Object.is(value, -0)) return '-0';
  return value;
}

function saleSubmissionCanonicalValue(input: SaleSubmissionInput): unknown[] {
  return [
    'sale_input_v1',
    input.salePaymentMethod,
    input.salePhotoTaken,
    input.salePhotoUri,
    [...input.salePhotoUris],
    input.saleLines.map((line) => [
      fingerprintNumber(line.productId),
      line.productName,
      fingerprintNumber(line.price),
      line.priceSource ?? null,
      fingerprintNumber(line.priceCapturedAtMs),
      fingerprintNumber(line.pricelistId),
      fingerprintNumber(line.qty),
      fingerprintNumber(line.stock),
      fingerprintNumber(line.weight),
    ]),
  ];
}

function hashSaleSubmissionCanonicalValue(value: unknown[]): string {
  const text = JSON.stringify(value);
  let h1 = 0x6a09e667;
  let h2 = 0xbb67ae85;
  let h3 = 0x3c6ef372;
  let h4 = 0xa54ff53a;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x85ebca6b);
    h2 = Math.imul(h2 ^ code, 0xc2b2ae35);
    h3 = Math.imul(h3 ^ code, 0x27d4eb2f);
    h4 = Math.imul(h4 ^ code, 0x165667b1);
  }
  return [h1, h2, h3, h4]
    .map((value32) => (value32 >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export function createSaleSubmissionFingerprint(input: SaleSubmissionInput): string {
  return `sale_input_v1_${hashSaleSubmissionCanonicalValue(
    saleSubmissionCanonicalValue(input),
  )}`;
}

export function captureSaleSubmissionInput(
  input: SaleSubmissionInput,
): CapturedSaleSubmissionInput {
  const saleLines = Object.freeze(input.saleLines.map((line) => Object.freeze({
    productId: line.productId,
    productName: line.productName,
    price: line.price,
    priceSource: line.priceSource ?? null,
    priceCapturedAtMs: line.priceCapturedAtMs ?? null,
    pricelistId: line.pricelistId ?? null,
    qty: line.qty,
    stock: line.stock,
    weight: line.weight,
  })));
  const salePhotoUris = Object.freeze([...input.salePhotoUris]);
  const subtotal = saleLines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const totalKg = saleLines.reduce((sum, line) => sum + line.weight * line.qty, 0);
  const normalizedInput: SaleSubmissionInput = {
    saleLines: saleLines.map((line) => ({
      ...line,
      priceSource: line.priceSource ?? undefined,
    })),
    salePaymentMethod: input.salePaymentMethod,
    salePhotoTaken: input.salePhotoTaken,
    salePhotoUri: input.salePhotoUri,
    salePhotoUris: [...salePhotoUris],
  };
  return Object.freeze({
    saleLines,
    salePaymentMethod: input.salePaymentMethod,
    salePhotoTaken: input.salePhotoTaken,
    salePhotoUri: input.salePhotoUri,
    salePhotoUris,
    subtotal,
    total: subtotal,
    totalKg,
    fingerprint: createSaleSubmissionFingerprint(normalizedInput),
  });
}

function sameCapturedSaleLine(
  expected: CapturedSaleSubmissionLine,
  current: CapturedSaleSubmissionLine,
): boolean {
  return expected.productId === current.productId
    && expected.productName === current.productName
    && Object.is(expected.price, current.price)
    && expected.priceSource === current.priceSource
    && Object.is(expected.priceCapturedAtMs, current.priceCapturedAtMs)
    && Object.is(expected.pricelistId, current.pricelistId)
    && Object.is(expected.qty, current.qty)
    && Object.is(expected.stock, current.stock)
    && Object.is(expected.weight, current.weight);
}

export function isSameSaleSubmissionInput(
  expected: CapturedSaleSubmissionInput,
  current: CapturedSaleSubmissionInput,
): boolean {
  return expected.fingerprint === current.fingerprint
    && expected.salePaymentMethod === current.salePaymentMethod
    && expected.salePhotoTaken === current.salePhotoTaken
    && expected.salePhotoUri === current.salePhotoUri
    && expected.salePhotoUris.length === current.salePhotoUris.length
    && expected.salePhotoUris.every((uri, index) => uri === current.salePhotoUris[index])
    && expected.saleLines.length === current.saleLines.length
    && expected.saleLines.every((line, index) => (
      sameCapturedSaleLine(line, current.saleLines[index])
    ))
    && Object.is(expected.subtotal, current.subtotal)
    && Object.is(expected.total, current.total)
    && Object.is(expected.totalKg, current.totalKg);
}

/**
 * Decides stock enforcement without conflating connectivity with inventory
 * authority. Only an explicit offline signal plus the visit-sale opt-in can
 * bypass stock. Unknown runtime connectivity always fails closed.
 */
export function decideSaleStockEnforcement(
  input: SaleStockEnforcementInput,
): SaleStockEnforcementDecision {
  if (!input || typeof input !== 'object') {
    return { ...BLOCKED_WITHOUT_AUTHORITY };
  }

  if (input.policy === 'strict') {
    return {
      allowConfirm: true,
      shouldRefresh: false,
      enforceFreshStock: true,
    };
  }

  if (input.policy !== 'offline_sale') {
    return {
      allowConfirm: false,
      shouldRefresh: false,
      enforceFreshStock: true,
    };
  }

  if (input.isOnline === false) {
    return {
      allowConfirm: true,
      shouldRefresh: false,
      enforceFreshStock: false,
    };
  }

  if (input.isOnline !== true) {
    return { ...BLOCKED_WITHOUT_AUTHORITY };
  }

  if (input.inventoryFreshness === 'authoritative') {
    return {
      allowConfirm: true,
      shouldRefresh: false,
      enforceFreshStock: true,
    };
  }

  return {
    allowConfirm: false,
    shouldRefresh: true,
    enforceFreshStock: false,
  };
}

export function shouldEnforceFreshSaleStock(
  input: SaleStockEnforcementInput,
): boolean {
  return decideSaleStockEnforcement(input).enforceFreshStock;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0;
}

function isNullablePositiveSafeInteger(value: unknown): value is number | null {
  return value === null || isPositiveSafeInteger(value);
}

function isValidStopId(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value !== 0;
}

function isActiveSaleVisitPhase(value: unknown): value is 'checked_in' | 'selling' {
  return value === 'checked_in' || value === 'selling';
}

function isValidSaleConfirmationContext(
  value: unknown,
): value is SaleConfirmationContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Partial<SaleConfirmationContext>;
  return context.isAuthenticated === true
    && (context.isOnline === true || context.isOnline === false)
    && isPositiveSafeInteger(context.employeeId)
    && isPositiveSafeInteger(context.companyId)
    && isPositiveSafeInteger(context.warehouseId)
    && isNullablePositiveSafeInteger(context.mobileLocationId)
    && isPositiveSafeInteger(context.planId)
    && isValidStopId(context.stopId)
    && isPositiveSafeInteger(context.partnerId)
    && isNullablePositiveSafeInteger(context.pricelistId)
    && isNullablePositiveSafeInteger(context.offrouteVisitId)
    && isActiveSaleVisitPhase(context.activeVisitPhase)
    && isValidStopId(context.activeVisitStopId)
    && isValidStopId(context.activeVisitCurrentStopId)
    && isPositiveSafeInteger(context.activeVisitPartnerId)
    && context.stopId === context.activeVisitStopId
    && context.activeVisitStopId === context.activeVisitCurrentStopId
    && context.partnerId === context.activeVisitPartnerId;
}

export function isSameSaleConfirmationContext(
  expected: SaleConfirmationContext,
  current: SaleConfirmationContext,
): boolean {
  if (
    !isValidSaleConfirmationContext(expected)
    || !isValidSaleConfirmationContext(current)
  ) {
    return false;
  }
  return expected.isOnline === current.isOnline
    && expected.employeeId === current.employeeId
    && expected.companyId === current.companyId
    && expected.warehouseId === current.warehouseId
    && expected.mobileLocationId === current.mobileLocationId
    && expected.planId === current.planId
    && expected.stopId === current.stopId
    && expected.partnerId === current.partnerId
    && expected.pricelistId === current.pricelistId
    && expected.offrouteVisitId === current.offrouteVisitId
    && expected.activeVisitPhase === current.activeVisitPhase
    && expected.activeVisitStopId === current.activeVisitStopId
    && expected.activeVisitCurrentStopId === current.activeVisitCurrentStopId
    && expected.activeVisitPartnerId === current.activeVisitPartnerId;
}

export function isApplicableAuthoritativeSaleInventory(input: {
  expectedContext: SaleConfirmationContext;
  currentContext: SaleConfirmationContext;
  inventory: SaleInventoryAuthorityState;
  loadResult?: InventoryLoadResult;
}): boolean {
  if (!input || typeof input !== 'object') return false;
  if (!isSameSaleConfirmationContext(
    input.expectedContext,
    input.currentContext,
  )) {
    return false;
  }
  if (input.expectedContext.isOnline !== true) return false;
  const inventory = input.inventory;
  if (!inventory || typeof inventory !== 'object') return false;
  if (
    inventory.inventoryFreshness !== 'authoritative'
    || inventory.loadedWarehouseId !== input.expectedContext.warehouseId
    || (
      inventory.inventorySource !== 'truck_stock'
      && inventory.inventorySource !== 'stock_quant'
    )
  ) {
    return false;
  }

  if (input.loadResult === undefined) return true;
  const result = input.loadResult;
  return result.ok === true
    && result.authoritative === true
    && result.warehouseId === input.expectedContext.warehouseId
    && result.source === inventory.inventorySource;
}

export function isApplicableSaleSubmissionContext(input: {
  expectedContext: SaleConfirmationContext;
  currentContext: SaleConfirmationContext;
  inventory: SaleInventoryAuthorityState;
}): boolean {
  if (!input || typeof input !== 'object') return false;
  if (!isSameSaleConfirmationContext(
    input.expectedContext,
    input.currentContext,
  )) {
    return false;
  }
  if (input.expectedContext.isOnline === false) return true;
  if (input.expectedContext.isOnline !== true) return false;
  return isApplicableAuthoritativeSaleInventory(input);
}
