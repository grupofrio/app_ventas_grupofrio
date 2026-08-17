/**
 * Narrow Kold Field invoice-collection contract.
 *
 * The employee Bearer session is the only source for accounting scope. This
 * module deliberately carries no partner, company, employee, plan, journal or
 * payment-method-line selector from the device.
 */

export type InvoiceCollectionPaymentMethod = 'cash' | 'transfer' | 'check';
export type InvoiceCollectionStatus = 'dispatching' | 'pending' | 'applied' | 'review_required';

export interface InvoiceCollectionRequest {
  operation_id: string;
  stop_id: number;
  invoice_id: number;
  amount: number;
  payment_method: InvoiceCollectionPaymentMethod;
}

export interface OpenInvoice {
  invoice_id: number;
  name: string;
  invoice_date: string | null;
  due_date: string | null;
  currency: string;
  amount_residual: number;
}

export interface InvoiceCollectionIntent extends InvoiceCollectionRequest {
  snapshot_residual: number;
  snapshot_as_of: string | null;
  status: InvoiceCollectionStatus;
  created_at_ms: number;
  updated_at_ms: number;
}

export type InvoiceCollectionServerResult =
  | { status: 'applied'; operation_id: string }
  | { status: 'review_required'; operation_id: string; reason?: string };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Set<InvoiceCollectionPaymentMethod>(['cash', 'transfer', 'check']);

function plainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('El intent de cobranza debe ser un objeto.');
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} debe ser positivo.`);
  return value;
}

function positiveAmount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${label} debe ser mayor que cero.`);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} no es válido.`);
  return value;
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  const unexpected = Object.keys(input).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`El campo ${unexpected} no está permitido.`);
}

export function assertInvoiceCollectionRequest(value: unknown): InvoiceCollectionRequest {
  const input = plainRecord(value);
  exactKeys(input, ['operation_id', 'stop_id', 'invoice_id', 'amount', 'payment_method']);
  if (typeof input.operation_id !== 'string' || !UUID_V4.test(input.operation_id)) throw new Error('operation_id debe ser UUID v4.');
  if (typeof input.payment_method !== 'string' || !METHODS.has(input.payment_method as InvoiceCollectionPaymentMethod)) {
    throw new Error('El método de pago no está permitido.');
  }
  return {
    operation_id: input.operation_id,
    stop_id: positiveInteger(input.stop_id, 'stop_id'),
    invoice_id: positiveInteger(input.invoice_id, 'invoice_id'),
    amount: positiveAmount(input.amount, 'amount'),
    payment_method: input.payment_method as InvoiceCollectionPaymentMethod,
  };
}

export function createInvoiceCollectionIntent(value: unknown): InvoiceCollectionIntent {
  const input = plainRecord(value);
  exactKeys(input, ['operation_id', 'stop_id', 'invoice_id', 'amount', 'payment_method', 'snapshot_residual', 'snapshot_as_of', 'now_ms']);
  const request = assertInvoiceCollectionRequest({
    operation_id: input.operation_id, stop_id: input.stop_id, invoice_id: input.invoice_id,
    amount: input.amount, payment_method: input.payment_method,
  });
  const snapshotResidual = positiveAmount(input.snapshot_residual, 'snapshot_residual');
  if (request.amount > snapshotResidual) throw new Error('El monto excede el saldo del snapshot.');
  const nowMs = input.now_ms === undefined ? Date.now() : positiveInteger(input.now_ms, 'now_ms');
  return {
    ...request,
    snapshot_residual: snapshotResidual,
    snapshot_as_of: nullableText(input.snapshot_as_of, 'snapshot_as_of'),
    status: 'dispatching', created_at_ms: nowMs, updated_at_ms: nowMs,
  };
}

export function requestFromIntent(intent: InvoiceCollectionIntent): InvoiceCollectionRequest {
  return assertInvoiceCollectionRequest({
    operation_id: intent.operation_id, stop_id: intent.stop_id, invoice_id: intent.invoice_id,
    amount: intent.amount, payment_method: intent.payment_method,
  });
}

function parseOpenInvoices(value: unknown): OpenInvoice[] {
  const data = plainRecord(value);
  const rows = Array.isArray(data.invoices) ? data.invoices : null;
  if (!rows) throw new Error('La respuesta de facturas no es válida.');
  return rows.map((row) => {
    const invoice = plainRecord(row);
    exactKeys(invoice, ['invoice_id', 'name', 'invoice_date', 'due_date', 'currency', 'amount_residual']);
    if (typeof invoice.name !== 'string' || typeof invoice.currency !== 'string') throw new Error('La respuesta de facturas no es válida.');
    return {
      invoice_id: positiveInteger(invoice.invoice_id, 'invoice_id'),
      name: invoice.name,
      invoice_date: nullableText(invoice.invoice_date, 'invoice_date'),
      due_date: nullableText(invoice.due_date, 'due_date'),
      currency: invoice.currency,
      amount_residual: positiveAmount(invoice.amount_residual, 'amount_residual'),
    };
  });
}

function parseServerResult(value: unknown, operationId: string): InvoiceCollectionServerResult {
  const data = plainRecord(value);
  if ((data.status !== 'applied' && data.status !== 'review_required') || data.operation_id !== operationId) {
    throw new Error('La respuesta de cobranza no es válida.');
  }
  return data.status === 'applied'
    ? { status: 'applied', operation_id: operationId }
    : { status: 'review_required', operation_id: operationId, ...(typeof data.reason === 'string' ? { reason: data.reason } : {}) };
}

/** Strict Employee-Bearer GET: the sole caller-supplied selector is stop_id. */
export async function fetchOpenInvoices(stopId: number): Promise<OpenInvoice[]> {
  positiveInteger(stopId, 'stop_id');
  const { getRest } = await import('./api.ts');
  const response = await getRest<unknown>(`/gf/logistics/api/employee/payments/open_invoices?stop_id=${stopId}`);
  return parseOpenInvoices(response);
}

/** Strict Employee-Bearer POST: serialize only the immutable five-field DTO. */
export async function submitInvoiceCollection(request: InvoiceCollectionRequest): Promise<InvoiceCollectionServerResult> {
  const { postRest } = await import('./api.ts');
  const body = {
    operation_id: request.operation_id,
    stop_id: request.stop_id,
    invoice_id: request.invoice_id,
    amount: request.amount,
    payment_method: request.payment_method,
  };
  const response = await postRest<unknown>('/gf/logistics/api/employee/payments/collect', body);
  return parseServerResult(response, request.operation_id);
}
