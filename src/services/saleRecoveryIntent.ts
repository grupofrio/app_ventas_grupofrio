import {
  normalizeOdooFolio,
  parseSaleTicketSnapshot,
  type SaleTicketSnapshot,
} from './saleTicket.ts';

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
    const ticketSnapshot = parseSaleTicketSnapshot(
      value.ticketSnapshot,
      value.operationId,
    );
    if (!ticketSnapshot) return null;

    return {
      version: 1,
      operationId: value.operationId,
      queuePayload: { ...value.queuePayload },
      stopId: value.stopId,
      photoUris: [...value.photoUris],
      ticketSnapshot: {
        ...ticketSnapshot,
        odooFolio: normalizeOdooFolio(ticketSnapshot.odooFolio),
      },
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
