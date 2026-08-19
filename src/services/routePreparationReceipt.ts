/**
 * Bounded, session-safe receipt for route preparation readiness.
 *
 * Preparation is NOT a blind boolean: the receipt binds to company, employee,
 * operational day, authoritative plan id and the day-bundle etag that was
 * active when preparation completed. On hydrate we re-validate against durable
 * artifacts (bundle lease, cached plan/products) before restoring UI state.
 */

export interface RoutePreparationReceiptV1 {
  version: 1;
  identity: {
    companyId: number;
    employeeId: number;
  };
  planId: number;
  operationalDate: string;
  bundleEtag: string;
  preparedAtMs: number;
  customersTotal: number;
  customersPrepared: number;
  pricesPrepared: number;
  failurePartnerIds: number[];
}

export interface RoutePreparationBindingContext {
  companyId: number;
  employeeId: number;
  operationalDate: string;
  nowMs: number;
  currentPlanId: number | null;
  bundleEtag: string | null;
  bundleCanStartRoute: boolean;
  hasPlan: boolean;
  stopsCount: number;
  productCount: number;
}

export type RoutePreparationAssessment =
  | { status: 'unprepared' }
  | {
      status: 'prepared';
      receipt: RoutePreparationReceiptV1;
      bundleExpired: false;
    }
  | {
      status: 'prepared_bundle_expired';
      receipt: RoutePreparationReceiptV1;
      message: string;
    }
  | {
      status: 'invalid_receipt';
      reason: string;
    };

function invalidReceipt(message: string): Error {
  return new Error(`Route preparation receipt inválido: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidReceipt(`${field} debe ser un entero positivo.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidReceipt(`${field} debe ser un entero no negativo.`);
  }
  return value;
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidReceipt(`${field} debe ser una fecha ISO.`);
  }
  return value;
}

export function buildRoutePreparationReceipt(input: {
  companyId: number;
  employeeId: number;
  planId: number;
  operationalDate: string;
  bundleEtag: string;
  preparedAtMs: number;
  customersTotal: number;
  customersPrepared: number;
  pricesPrepared: number;
  failures: Array<{ partnerId: number }>;
}): RoutePreparationReceiptV1 {
  const bundleEtag = input.bundleEtag.trim();
  if (!bundleEtag) throw invalidReceipt('bundleEtag es requerido.');
  if (!Number.isSafeInteger(input.preparedAtMs) || input.preparedAtMs <= 0) {
    throw invalidReceipt('preparedAtMs no es válido.');
  }
  return {
    version: 1,
    identity: {
      companyId: positiveInteger(input.companyId, 'companyId'),
      employeeId: positiveInteger(input.employeeId, 'employeeId'),
    },
    planId: positiveInteger(input.planId, 'planId'),
    operationalDate: isoDate(input.operationalDate, 'operationalDate'),
    bundleEtag,
    preparedAtMs: input.preparedAtMs,
    customersTotal: nonNegativeInteger(input.customersTotal, 'customersTotal'),
    customersPrepared: nonNegativeInteger(input.customersPrepared, 'customersPrepared'),
    pricesPrepared: nonNegativeInteger(input.pricesPrepared, 'pricesPrepared'),
    failurePartnerIds: input.failures
      .map((failure) => failure.partnerId)
      .filter((partnerId) => Number.isSafeInteger(partnerId) && partnerId > 0),
  };
}

export function parseRoutePreparationReceipt(value: unknown): RoutePreparationReceiptV1 | null {
  try {
    if (!isRecord(value) || value.version !== 1) return null;
    const identity = value.identity;
    if (!isRecord(identity)) return null;
    const companyId = positiveInteger(identity.companyId, 'identity.companyId');
    const employeeId = positiveInteger(identity.employeeId, 'identity.employeeId');
    const bundleEtag = typeof value.bundleEtag === 'string' ? value.bundleEtag.trim() : '';
    if (!bundleEtag) return null;
    const failurePartnerIds = Array.isArray(value.failurePartnerIds)
      ? value.failurePartnerIds.flatMap((entry) => (
        typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0 ? [entry] : []
      ))
      : [];
    return {
      version: 1,
      identity: { companyId, employeeId },
      planId: positiveInteger(value.planId, 'planId'),
      operationalDate: isoDate(value.operationalDate, 'operationalDate'),
      bundleEtag,
      preparedAtMs: positiveInteger(value.preparedAtMs, 'preparedAtMs'),
      customersTotal: nonNegativeInteger(value.customersTotal, 'customersTotal'),
      customersPrepared: nonNegativeInteger(value.customersPrepared, 'customersPrepared'),
      pricesPrepared: nonNegativeInteger(value.pricesPrepared, 'pricesPrepared'),
      failurePartnerIds,
    };
  } catch {
    return null;
  }
}

export function receiptMatchesBinding(
  receipt: RoutePreparationReceiptV1,
  context: RoutePreparationBindingContext,
): boolean {
  if (receipt.identity.companyId !== context.companyId) return false;
  if (receipt.identity.employeeId !== context.employeeId) return false;
  if (receipt.operationalDate !== context.operationalDate) return false;
  if (context.currentPlanId === null || receipt.planId !== context.currentPlanId) return false;
  if (!context.bundleEtag || receipt.bundleEtag !== context.bundleEtag) return false;
  if (!context.hasPlan || context.stopsCount <= 0) return false;
  if (context.productCount <= 0) return false;
  return true;
}

export function assessRoutePreparationReceipt(
  rawReceipt: unknown,
  context: RoutePreparationBindingContext,
): RoutePreparationAssessment {
  const receipt = parseRoutePreparationReceipt(rawReceipt);
  if (!receipt) {
    return { status: 'unprepared' };
  }
  if (!receiptMatchesBinding(receipt, context)) {
    return {
      status: 'invalid_receipt',
      reason: 'La preparación guardada no corresponde a esta sesión, plan o bundle.',
    };
  }
  if (!context.bundleCanStartRoute) {
    return {
      status: 'prepared_bundle_expired',
      receipt,
      message: 'El bundle del día está vencido. Solo puedes consultar datos hasta renovarlo con conexión.',
    };
  }
  return { status: 'prepared', receipt, bundleExpired: false };
}

export function receiptToStoreSnapshot(receipt: RoutePreparationReceiptV1): {
  preparedAt: number;
  preparedPlanId: number;
  customersTotal: number;
  customersPrepared: number;
  pricesPrepared: number;
  failures: Array<{ partnerId: number; reason: string }>;
} {
  return {
    preparedAt: receipt.preparedAtMs,
    preparedPlanId: receipt.planId,
    customersTotal: receipt.customersTotal,
    customersPrepared: receipt.customersPrepared,
    pricesPrepared: receipt.pricesPrepared,
    failures: receipt.failurePartnerIds.map((partnerId) => ({
      partnerId,
      reason: 'Pendiente desde la última preparación',
    })),
  };
}
