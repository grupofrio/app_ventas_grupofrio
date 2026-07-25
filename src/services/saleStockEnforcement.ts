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

const BLOCKED_WITHOUT_AUTHORITY: SaleStockEnforcementDecision = {
  allowConfirm: false,
  shouldRefresh: false,
  enforceFreshStock: false,
};

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
