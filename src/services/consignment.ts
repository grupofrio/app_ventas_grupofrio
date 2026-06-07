/**
 * Consignación network service (gf_consignment) — CONTRATO REAL (Sebas).
 *
 * Endpoints (auth api_key; empleado por X-GF-Employee-Token que ya manda
 * buildHeaders + employee_id en payload):
 *   GET  /pwa-ruta/consignment/my-active?partner_id=N[&company_id=M]
 *   POST /pwa-ruta/consignment/create
 *   POST /pwa-ruta/consignment/visit
 *   POST /pwa-ruta/consignment/close
 *
 * Respuesta: { ok, message, data:{ consignment: <obj> | false } }.
 * Online-first; postRest lanza en ok:false / HTTP>=400 → nunca simula éxito.
 * El backend es la fuente de verdad (inventario, venta/cobro, resurtido,
 * devolución, cierre). La app sólo manda conteos/objetivos y muestra
 * preliminar. La respuesta NO trae sold_qty/folio → no se depende de ellos.
 */

import { postRest, getRest } from './api';
import { logInfo } from '../utils/logger';
import type {
  ActiveConsignment,
  ConsignmentLine,
  CreateConsignmentLine,
  ConsignmentCountLine,
  ConsignmentPaymentMethod,
  ConsignmentMutationResult,
} from '../types/consignment';

const ENDPOINTS = {
  myActive: 'pwa-ruta/consignment/my-active',
  create: 'pwa-ruta/consignment/create',
  visit: 'pwa-ruta/consignment/visit',
  close: 'pwa-ruta/consignment/close',
} as const;

/** Contrato confirmado por Sebas → operaciones reales habilitadas. */
export const CONSIGNMENT_BACKEND_CONFIRMED = true;

function num(v: unknown): number {
  if (Array.isArray(v)) return num(v[0]);
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string {
  if (Array.isArray(v)) return typeof v[1] === 'string' ? v[1] : String(v[0] ?? '');
  return typeof v === 'string' ? v : '';
}
function bool(v: unknown): boolean {
  return v === true;
}

function normalizeLine(raw: Record<string, unknown>): ConsignmentLine {
  return {
    line_id: num(raw.line_id ?? raw.id),
    product_id: num(raw.product_id),
    product_name: str(raw.product_name) || str(raw.name),
    product_uom_id: numOrNull(raw.product_uom_id),
    price_unit: num(raw.price_unit),
    target_qty: num(raw.target_qty),
    current_qty: num(raw.current_qty),
    last_count_qty: num(raw.last_count_qty),
    active: raw.active === undefined ? true : bool(raw.active),
  };
}

/** Extrae `data.consignment`. `false`/ausente → null. */
function parseConsignment(result: unknown): ActiveConsignment | null {
  if (!result || typeof result !== 'object') return null;
  const payload = result as Record<string, unknown>;
  const data = (payload.data ?? payload) as Record<string, unknown>;
  const c = data?.consignment;
  if (!c || c === true || typeof c !== 'object') return null;
  const obj = c as Record<string, unknown>;
  const rawLines = Array.isArray(obj.lines) ? obj.lines : [];
  return {
    id: num(obj.id),
    name: str(obj.name),
    partner_id: num(obj.partner_id),
    partner_name: str(obj.partner_name),
    company_id: numOrNull(obj.company_id),
    employee_id: numOrNull(obj.employee_id),
    route_plan_id: numOrNull(obj.route_plan_id),
    vehicle_id: numOrNull(obj.vehicle_id),
    mobile_location_id: numOrNull(obj.mobile_location_id),
    state: str(obj.state) || 'active',
    date_opened: str(obj.date_opened),
    last_visit_date: str(obj.last_visit_date),
    date_closed: str(obj.date_closed),
    lines: (rawLines as unknown[])
      .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
      .map(normalizeLine),
  };
}

function messageOf(result: unknown, fallback: string): string {
  if (result && typeof result === 'object') {
    const m = (result as Record<string, unknown>).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

/** GET consignación activa del cliente (null si no tiene). */
export async function getActiveConsignment(
  partnerId: number,
  companyId?: number | null,
): Promise<ActiveConsignment | null> {
  let url = `${ENDPOINTS.myActive}?partner_id=${partnerId}`;
  if (typeof companyId === 'number' && companyId > 0) url += `&company_id=${companyId}`;
  const result = await getRest<unknown>(url);
  return parseConsignment(result);
}

interface CreateInput {
  partnerId: number;
  companyId: number | null;
  employeeId: number | null;
  routePlanId: number | null;
  mobileLocationId: number | null;
  vehicleId: number | null;
  notes?: string;
  lines: CreateConsignmentLine[];
}

/** POST crear consignación inicial. apply_inventory:true → backend baja stock. */
export async function createConsignment(input: CreateInput): Promise<ConsignmentMutationResult> {
  const body: Record<string, unknown> = {
    partner_id: input.partnerId,
    employee_id: input.employeeId,
    apply_inventory: true,
    lines: input.lines,
  };
  if (input.companyId != null) body.company_id = input.companyId;
  if (input.routePlanId != null) body.route_plan_id = input.routePlanId;
  if (input.mobileLocationId != null) body.mobile_location_id = input.mobileLocationId;
  if (input.vehicleId != null) body.vehicle_id = input.vehicleId;
  if (input.notes && input.notes.trim()) body.notes = input.notes.trim();

  const result = await postRest<unknown>(ENDPOINTS.create, body);
  logInfo('general', 'consignment_create', { partner_id: input.partnerId, lines: input.lines.length });
  return {
    ok: true,
    message: messageOf(result, 'Consignación creada'),
    consignment: parseConsignment(result),
  };
}

interface CountInput {
  consignmentId: number;
  operationId: string;
  paymentMethod: ConsignmentPaymentMethod;
  counts: ConsignmentCountLine[];
}

/** POST visita: conteo físico → backend cobra faltante y resurte al objetivo. */
export async function visitConsignment(input: CountInput): Promise<ConsignmentMutationResult> {
  const result = await postRest<unknown>(ENDPOINTS.visit, {
    consignment_id: input.consignmentId,
    operation_id: input.operationId,
    payment_method: input.paymentMethod,
    counts: input.counts,
  });
  logInfo('general', 'consignment_visit', { consignment_id: input.consignmentId, counts: input.counts.length });
  return {
    ok: true,
    message: messageOf(result, 'Visita de consignación registrada'),
    consignment: parseConsignment(result),
  };
}

/** POST cierre: conteo físico final → cobra faltante + devuelve resto + cierra. */
export async function closeConsignment(input: CountInput): Promise<ConsignmentMutationResult> {
  const result = await postRest<unknown>(ENDPOINTS.close, {
    consignment_id: input.consignmentId,
    operation_id: input.operationId,
    payment_method: input.paymentMethod,
    counts: input.counts,
  });
  logInfo('general', 'consignment_close', { consignment_id: input.consignmentId });
  return {
    ok: true,
    message: messageOf(result, 'Consignación cerrada'),
    consignment: parseConsignment(result),
  };
}
