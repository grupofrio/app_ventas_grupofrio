import type { SaleTicketSnapshot } from './saleTicket.ts';

export interface SaleRecoveryIntentV1 {
  version: 1;
  operationId: string;
  queuePayload: Record<string, unknown>;
  stopId: number;
  photoUris: string[];
  ticketSnapshot: SaleTicketSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validOptionalOrigin(
  value: unknown,
): value is SaleTicketSnapshot['origin'] | undefined {
  return value === undefined || value === 'local' || value === 'odoo';
}

function validOptionalPriceSource(
  value: unknown,
): value is SaleTicketSnapshot['lines'][number]['priceSource'] | undefined {
  return (
    value === undefined
    || value === 'prepared_customer'
    || value === 'last_known_customer'
    || value === 'public_fallback'
  );
}

function validOptionalCapturedAt(value: unknown): value is number | null | undefined {
  return (
    value === undefined
    || value === null
    || (finiteNumber(value) && value >= 0)
  );
}

function validOptionalPricelistId(value: unknown): value is number | null | undefined {
  return (
    value === undefined
    || value === null
    || (typeof value === 'number' && Number.isInteger(value) && value > 0)
  );
}

function restoreTicketSnapshot(value: unknown, operationId: string): SaleTicketSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    value.saleId !== operationId
    || typeof value.customerName !== 'string'
    || typeof value.sellerName !== 'string'
    || !['cash', 'credit', 'transfer', 'unknown'].includes(String(value.paymentMethod))
    || typeof value.paymentLabel !== 'string'
    || typeof value.createdAt !== 'string'
    || !Array.isArray(value.lines)
    || !finiteNumber(value.subtotal)
    || !finiteNumber(value.total)
    || !finiteNumber(value.totalKg)
    || !validOptionalOrigin(value.origin)
  ) {
    return null;
  }

  const lines = value.lines.map((candidate) => {
    if (!isRecord(candidate)) return null;
    if (
      !finiteNumber(candidate.productId)
      || typeof candidate.productName !== 'string'
      || !finiteNumber(candidate.qty)
      || !finiteNumber(candidate.unitPrice)
      || !finiteNumber(candidate.lineTotal)
      || !finiteNumber(candidate.weight)
      || !validOptionalPriceSource(candidate.priceSource)
      || !validOptionalCapturedAt(candidate.priceCapturedAtMs)
      || !validOptionalPricelistId(candidate.pricelistId)
    ) {
      return null;
    }
    return {
      productId: candidate.productId,
      productName: candidate.productName,
      qty: candidate.qty,
      unitPrice: candidate.unitPrice,
      lineTotal: candidate.lineTotal,
      ...(candidate.priceSource === undefined
        ? {}
        : { priceSource: candidate.priceSource }),
      ...(candidate.priceCapturedAtMs === undefined
        ? {}
        : { priceCapturedAtMs: candidate.priceCapturedAtMs }),
      ...(candidate.pricelistId === undefined
        ? {}
        : { pricelistId: candidate.pricelistId }),
      weight: candidate.weight,
    };
  });
  if (lines.some((line) => line === null)) return null;

  return {
    saleId: value.saleId,
    ...(value.origin === undefined ? {} : { origin: value.origin }),
    customerName: value.customerName,
    sellerName: value.sellerName,
    paymentMethod: value.paymentMethod as SaleTicketSnapshot['paymentMethod'],
    paymentLabel: value.paymentLabel,
    createdAt: value.createdAt,
    lines: lines as SaleTicketSnapshot['lines'],
    subtotal: value.subtotal,
    total: value.total,
    totalKg: value.totalKg,
  };
}

export function restoreSaleRecoveryIntent(value: unknown): SaleRecoveryIntentV1 | null {
  try {
    if (!isRecord(value) || value.version !== 1) return null;
    if (typeof value.operationId !== 'string' || value.operationId.trim() !== value.operationId) {
      return null;
    }
    if (value.operationId.length === 0 || !isRecord(value.queuePayload)) return null;
    if (value.queuePayload._operationId !== value.operationId) return null;
    if (
      typeof value.queuePayload._clientCustomerName !== 'string'
      || !finiteNumber(value.queuePayload._clientTotal)
    ) {
      return null;
    }
    if (
      typeof value.stopId !== 'number'
      || !Number.isInteger(value.stopId)
      || !Array.isArray(value.photoUris)
    ) return null;
    if (!value.photoUris.every((uri) => typeof uri === 'string')) return null;
    const ticketSnapshot = restoreTicketSnapshot(value.ticketSnapshot, value.operationId);
    if (!ticketSnapshot) return null;

    return {
      version: 1,
      operationId: value.operationId,
      queuePayload: { ...value.queuePayload },
      stopId: value.stopId,
      photoUris: [...value.photoUris],
      ticketSnapshot,
    };
  } catch {
    return null;
  }
}

export function createSaleRecoveryIntent(value: SaleRecoveryIntentV1): SaleRecoveryIntentV1 {
  const intent = restoreSaleRecoveryIntent(value);
  if (!intent) {
    throw new Error('Invalid sale recovery intent');
  }
  return intent;
}
