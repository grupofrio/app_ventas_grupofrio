export const FIELD_EVENT_PATH = 'gf/logistics/api/employee/field-events';
export const OPERATION_FAILURE_QUEUE_LIMIT = 40;

export type OperationFailureOutcome = 'rejected' | 'failed' | 'dead';

export interface OperationFailureInput {
  operation: string;
  operationId?: string | null;
  stopId?: number | null;
  planId?: number | null;
  error: unknown;
  outcome: OperationFailureOutcome;
}

export interface OperationFailureReport {
  occurred_at: string;
  operation: string;
  operation_id: string | null;
  stop_id: number | null;
  stop_ref: string | null;
  seller_name: string | null;
  plan_id: number | null;
  error_code: string;
  error_message: string;
  outcome: OperationFailureOutcome;
}

const SYNC_OPERATION_NAMES: Record<string, string> = {
  sale_order: 'sale',
  gift: 'gift',
  exchange: 'exchange',
  photo: 'photo',
  offroute_visit_close: 'offroute',
  prospection: 'prospect_convert',
};

export function operationNameForSyncType(type: string): string {
  return SYNC_OPERATION_NAMES[type] ?? type;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function readFailureError(error: unknown): { code: string; message: string } {
  if (typeof error === 'string' && error.trim()) {
    return { code: 'APP_ERROR', message: error.trim().slice(0, 500) };
  }
  const record = asRecord(error);
  if (!record) return { code: 'APP_ERROR', message: 'Error sin mensaje' };
  const data = asRecord(record.data);
  const reason = readText(record.reason)
    || readText(record.detail_code)
    || readText(data?.reason)
    || readText(data?.detail_code);
  const code = readText(record.code);
  const status = typeof record.httpStatus === 'number' && Number.isFinite(record.httpStatus)
    ? `HTTP_${record.httpStatus}`
    : '';
  const message = readText(record.message)
    || readText(record.user_message)
    || readText(data?.message)
    || 'Error sin mensaje';
  const exactCode = (reason && code && reason !== code ? `${code}:${reason}` : (code || reason || status || 'APP_ERROR')).slice(0, 80);
  return { code: exactCode, message: message.slice(0, 500) };
}

export function buildOperationFailureReport(
  input: OperationFailureInput,
  sellerName: string,
  occurredAt: string,
): OperationFailureReport | null {
  const operation = input.operation.trim().slice(0, 40);
  if (!operation) return null;
  if (Number.isNaN(Date.parse(occurredAt))) return null;
  const failure = readFailureError(input.error);
  const stopId = positiveId(input.stopId);
  const seller = sellerName.trim();
  return {
    occurred_at: new Date(occurredAt).toISOString(),
    operation,
    operation_id: readText(input.operationId).slice(0, 80) || null,
    stop_id: stopId,
    stop_ref: typeof input.stopId === 'number' && Number.isFinite(input.stopId) ? String(input.stopId) : null,
    seller_name: seller ? seller.slice(0, 120) : null,
    plan_id: positiveId(input.planId),
    error_code: failure.code,
    error_message: failure.message,
    outcome: input.outcome,
  };
}

export function operationFailureKey(report: OperationFailureReport): string {
  return [
    report.operation,
    report.operation_id ?? '',
    report.stop_ref ?? '',
    report.error_code,
    report.error_message,
    report.outcome,
  ].join('|');
}

export function enqueueOperationFailure(
  queue: OperationFailureReport[],
  report: OperationFailureReport,
): OperationFailureReport[] {
  const key = operationFailureKey(report);
  if (queue.some((item) => operationFailureKey(item) === key)) return queue;
  return [...queue, report].slice(-OPERATION_FAILURE_QUEUE_LIMIT);
}

export function isFieldEventEndpointMissing(error: unknown): boolean {
  const record = asRecord(error);
  const status = record && typeof record.httpStatus === 'number' ? record.httpStatus : null;
  if (status === 404 || status === 405 || status === 501) return true;
  const message = error instanceof Error ? error.message : '';
  return /not found|no existe|método desconocido|metodo desconocido|unknown method/i.test(message);
}

export function isFieldEventPayloadRejected(error: unknown): boolean {
  const record = asRecord(error);
  const status = record && typeof record.httpStatus === 'number' ? record.httpStatus : null;
  return status === 400 || status === 422;
}
