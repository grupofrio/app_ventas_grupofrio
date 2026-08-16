/** Pure validation for the bounded employee REST contracts. */

export type EmployeeIncidentType = 'operation' | 'customer' | 'quality' | 'collection' | 'vehicle';
export type EmployeeIncidentSeverity = 'low' | 'medium' | 'high';

export interface EmployeeIncidentCreateInput {
  operation_id: string;
  stop_id: number;
  name: string;
  incident_type: EmployeeIncidentType;
  severity: EmployeeIncidentSeverity;
  requires_follow_up?: boolean;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validationError(message: string): Error & { code: 'validation_error'; httpStatus: 422 } {
  const error = new Error(message) as Error & { code: 'validation_error'; httpStatus: 422 };
  error.code = 'validation_error';
  error.httpStatus = 422;
  return error;
}

export function objectPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload || Array.isArray(payload)) {
    throw validationError('El payload debe ser un objeto.');
  }
  return payload;
}

function allowOnly(payload: Record<string, unknown>, allowed: readonly string[]): void {
  const unexpected = Object.keys(payload).find((key) => !allowed.includes(key));
  if (unexpected) {
    throw validationError(`El campo ${unexpected} no está permitido.`);
  }
}

export function positiveId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw validationError(`${field} debe ser un entero positivo.`);
  }
  return value;
}

export function shortString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw validationError(`${field} debe ser texto.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw validationError(`${field} debe tener entre 1 y ${maxLength} caracteres.`);
  }
  return normalized;
}

export function shortChoice<T extends string>(value: unknown, field: string, values: readonly T[]): T {
  const normalized = shortString(value, field, 32);
  if (!values.includes(normalized as T)) {
    throw validationError(`${field} no es válido.`);
  }
  return normalized as T;
}

/** Validate and normalize the entire allowlisted incident-create request. */
export function normalizeEmployeeIncidentCreate(payload: Record<string, unknown>): Required<EmployeeIncidentCreateInput> {
  const data = objectPayload(payload);
  allowOnly(data, [
    'operation_id', 'stop_id', 'name', 'incident_type', 'severity', 'requires_follow_up',
  ]);

  const operationId = shortString(data.operation_id, 'operation_id', 36);
  if (!UUID_V4.test(operationId)) {
    throw validationError('operation_id debe ser un UUID v4.');
  }
  if (data.requires_follow_up !== undefined && typeof data.requires_follow_up !== 'boolean') {
    throw validationError('requires_follow_up debe ser booleano.');
  }

  return {
    operation_id: operationId,
    stop_id: positiveId(data.stop_id, 'stop_id'),
    name: shortString(data.name, 'name', 160),
    incident_type: shortChoice(data.incident_type, 'incident_type', [
      'operation', 'customer', 'quality', 'collection', 'vehicle',
    ]),
    severity: shortChoice(data.severity, 'severity', ['low', 'medium', 'high']),
    requires_follow_up: data.requires_follow_up ?? false,
  };
}

/** Validate the shared, authority-free date filter used by list and insights. */
export function normalizeEmployeeDateQuery(payload: Record<string, unknown> = {}): { date?: string } {
  const data = objectPayload(payload);
  allowOnly(data, ['date']);
  if (data.date === undefined) return {};
  const date = shortString(data.date, 'date', 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00.000Z`)
    : null;
  if (!parsed || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw validationError('date debe ser una fecha ISO válida.');
  }
  return { date };
}
