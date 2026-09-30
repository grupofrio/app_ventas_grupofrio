import { readSaleSubmissionErrorMetadata } from './saleSubmissionOutcome.ts';

export type SalesOpsMutationOutcomeKind =
  | 'definitive_rejection'
  | 'busy'
  | 'ambiguous_result';

export type SalesOpsQueueFailureDisposition = 'retry' | 'reject' | 'hold';

export interface GiftCreateResponseData {
  sale_order_id: number | null;
  sale_order_name: string;
  gift_id: number | null;
  gift_name: string;
  picking_id: number | null;
  state: string;
}

export interface GiftCreateResult {
  userMessage: string;
  data: GiftCreateResponseData;
  code: string | null;
}

export interface ExchangeCreateResultData {
  exchange_id: number;
  exchange_name: string;
  picking_delivery_id: number | null;
  picking_merma_id: number | null;
  state: string;
}

export interface ExchangeCreateResult {
  user_message: string;
  data: ExchangeCreateResultData;
}

export interface ExchangeCreatePickingRequirements {
  requireDeliveryPicking: boolean;
  requireMermaPicking: boolean;
}

interface SalesOpsMutationError extends Error {
  code: string;
  responseReceived: true;
  httpStatus?: number;
  outcomeKind: SalesOpsMutationOutcomeKind;
  data?: unknown;
}

const DEFINITIVE_CODES = new Set([
  'ACCESS_DENIED',
  'FORBIDDEN',
  'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
  'INSUFFICIENT_STOCK',
  'NOT_FOUND',
  'SERVER_MISCONFIG',
  'SESSION_EXPIRED',
  'UNAUTHORIZED',
  'VALIDATION_ERROR',
]);

const BUSY_CODES = new Set(['LOCK_BUSY', 'LOCKED']);
const AMBIGUOUS_CODES = new Set([
  'INVALID_RESPONSE',
  'NETWORK_ERROR',
  'SERVER_ERROR',
  'TIMEOUT',
]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function numericHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 400
    && value <= 599
    ? value
    : undefined;
}

function makeOutcomeError(input: {
  message: string;
  code: string;
  kind: SalesOpsMutationOutcomeKind;
  httpStatus?: number;
  data?: unknown;
}): SalesOpsMutationError {
  const error = new Error(input.message) as SalesOpsMutationError;
  error.name = 'SalesOpsMutationError';
  error.code = input.code;
  error.responseReceived = true;
  error.outcomeKind = input.kind;
  if (input.httpStatus !== undefined) error.httpStatus = input.httpStatus;
  if (input.data !== undefined) error.data = input.data;
  return error;
}

function kindFromBackendError(code: string, httpStatus?: number): SalesOpsMutationOutcomeKind {
  const normalized = code.trim().toUpperCase();
  if (BUSY_CODES.has(normalized)) return 'busy';
  if (DEFINITIVE_CODES.has(normalized)) return 'definitive_rejection';
  if (AMBIGUOUS_CODES.has(normalized)) return 'ambiguous_result';
  if (httpStatus !== undefined && httpStatus >= 500) return 'ambiguous_result';
  if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500) {
    return 'definitive_rejection';
  }
  // An explicit backend `status:error` is a rejection even if a future code is
  // not yet known by this app. Unexpected exceptions use SERVER_ERROR.
  return 'definitive_rejection';
}

function rejectBackendEnvelope(record: Record<string, unknown>): void {
  const envelopeStatus = nonEmptyString(record.status).toLowerCase();
  const isRejected = record.ok === false || envelopeStatus === 'error' || envelopeStatus === 'busy';
  if (!isRejected) return;

  const code = nonEmptyString(record.code) || (envelopeStatus === 'busy' ? 'LOCK_BUSY' : 'API_REJECTION');
  const httpStatus = numericHttpStatus(record.status);
  const message = nonEmptyString(record.message)
    || nonEmptyString(record.user_message)
    || 'El servidor rechazó la operación.';
  const kind = envelopeStatus === 'busy'
    ? 'busy'
    : kindFromBackendError(code, httpStatus);

  throw makeOutcomeError({
    message,
    code,
    kind,
    httpStatus,
    data: record.data,
  });
}

function invalidResponse(operation: 'regalo' | 'cambio'): never {
  throw makeOutcomeError({
    message: `Odoo respondió sin confirmar la identidad del ${operation}.`,
    code: 'invalid_response',
    kind: 'ambiguous_result',
  });
}

export function requireSalesOpsIdempotencyKey(value: unknown): string {
  const direct = nonEmptyString(value);
  const record = recordOf(value);
  const nested = nonEmptyString(recordOf(record?.meta)?.idempotency_key);
  const key = direct || nested;
  if (key) return key;
  return rejectSalesOpsClientPayload('La operación no tiene una llave idempotente válida.');
}

export function rejectSalesOpsClientPayload(message: string): never {
  throw makeOutcomeError({
    message,
    code: 'INVALID_CLIENT_PAYLOAD',
    kind: 'definitive_rejection',
  });
}

export function parseGiftCreateResponse(value: unknown): GiftCreateResult {
  const record = recordOf(value);
  if (!record) return invalidResponse('regalo');
  rejectBackendEnvelope(record);

  const data = recordOf(record.data);
  if (!data) return invalidResponse('regalo');

  const saleOrderId = positiveNumber(data.sale_order_id);
  const giftId = positiveNumber(data.gift_id);
  const saleOrderName = nonEmptyString(data.sale_order_name);
  const giftName = nonEmptyString(data.gift_name);
  const pickingId = positiveNumber(data.picking_id);
  const state = nonEmptyString(data.state).toLowerCase();
  const userMessage = nonEmptyString(record.user_message);

  if (
    !userMessage
    || !saleOrderId
    || !saleOrderName
    || !giftName
    || !pickingId
    || (state !== 'sale' && state !== 'done')
  ) {
    return invalidResponse('regalo');
  }

  return {
    userMessage,
    code: nonEmptyString(record.code) || null,
    data: {
      sale_order_id: saleOrderId,
      sale_order_name: saleOrderName,
      gift_id: giftId,
      gift_name: giftName,
      picking_id: pickingId,
      state,
    },
  };
}

export function parseExchangeCreateResponse(
  value: unknown,
  requirements: ExchangeCreatePickingRequirements,
): ExchangeCreateResult {
  const record = recordOf(value);
  if (!record) return invalidResponse('cambio');
  rejectBackendEnvelope(record);

  const data = recordOf(record.data);
  if (!data) return invalidResponse('cambio');

  const exchangeId = positiveNumber(data.exchange_id);
  const exchangeName = nonEmptyString(data.exchange_name);
  const deliveryPickingId = positiveNumber(data.picking_delivery_id);
  const mermaPickingId = positiveNumber(data.picking_merma_id);
  const state = nonEmptyString(data.state).toLowerCase();
  const userMessage = nonEmptyString(record.user_message);
  if (
    !userMessage
    || !exchangeId
    || !exchangeName
    || state !== 'done'
    || (requirements.requireDeliveryPicking && !deliveryPickingId)
    || (requirements.requireMermaPicking && !mermaPickingId)
  ) {
    return invalidResponse('cambio');
  }

  return {
    user_message: userMessage,
    data: {
      exchange_id: exchangeId,
      exchange_name: exchangeName,
      picking_delivery_id: deliveryPickingId,
      picking_merma_id: mermaPickingId,
      state,
    },
  };
}

export function classifySalesOpsMutationError(error: unknown): {
  kind: SalesOpsMutationOutcomeKind;
} {
  const record = recordOf(error);
  const taggedKind = record?.outcomeKind;
  if (
    taggedKind === 'definitive_rejection'
    || taggedKind === 'busy'
    || taggedKind === 'ambiguous_result'
  ) {
    return { kind: taggedKind };
  }

  const metadata = readSaleSubmissionErrorMetadata(error);
  const code = metadata.code?.trim().toUpperCase() || '';
  if (BUSY_CODES.has(code)) return { kind: 'busy' };
  if (metadata.responseReceived === false) return { kind: 'ambiguous_result' };
  if (DEFINITIVE_CODES.has(code)) return { kind: 'definitive_rejection' };
  if (AMBIGUOUS_CODES.has(code)) return { kind: 'ambiguous_result' };
  if (metadata.httpStatus !== undefined && metadata.httpStatus >= 500) {
    return { kind: 'ambiguous_result' };
  }
  if (
    metadata.httpStatus !== undefined
    && metadata.httpStatus >= 400
    && metadata.httpStatus < 500
  ) {
    return { kind: 'definitive_rejection' };
  }
  return { kind: 'ambiguous_result' };
}

export function resolveSalesOpsQueueFailure(
  type: 'gift' | 'exchange',
  error: unknown,
  retriesAfterFailure: number,
  maxRetries: number,
): SalesOpsQueueFailureDisposition {
  void type;
  const outcome = classifySalesOpsMutationError(error);
  if (outcome.kind === 'definitive_rejection') return 'reject';
  return retriesAfterFailure >= maxRetries ? 'hold' : 'retry';
}
