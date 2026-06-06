/**
 * Consignación network service (gf_consignment).
 *
 * ⚠️ CONTRATO ASUMIDO — el módulo backend NO es accesible desde este repo.
 * Los paths, payloads y formas de respuesta se derivan de la descripción
 * funcional + las convenciones de los endpoints /pwa-ruta. **Sebas debe
 * confirmar.** Si difieren, AJUSTAR SÓLO ESTE ARCHIVO (un único lugar):
 *   - paths en ENDPOINTS
 *   - campos en los payloads (buildCreate/Visit/Close)
 *   - parseo en normalize*()
 *
 * Online-first (no hay cola offline para consignación). postRest lanza en
 * ok:false / HTTP>=400 (envelope, fix #16) → nunca simula éxito.
 *
 * Fuente de verdad = backend para inventario, venta/cobro, resurtido,
 * devolución y cierre. La app sólo manda conteos y muestra preliminar.
 */

import { postRest, getRest } from './api';
import { logInfo } from '../utils/logger';
import type {
  ActiveConsignment,
  ConsignmentLine,
  CreateConsignmentLine,
  PhysicalCountLine,
  ConsignmentCreateResult,
  ConsignmentVisitResult,
  ConsignmentCloseResult,
} from '../types/consignment';

const ENDPOINTS = {
  myActive: 'pwa-ruta/consignment/my-active',
  create: 'pwa-ruta/consignment/create',
  visit: 'pwa-ruta/consignment/visit',
  close: 'pwa-ruta/consignment/close',
} as const;

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
function unwrap(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const payload = result as Record<string, unknown>;
  const data = payload.data !== undefined ? payload.data : payload;
  if (!data || typeof data !== 'object') return null;
  return data as Record<string, unknown>;
}

function normalizeLine(raw: Record<string, unknown>): ConsignmentLine {
  return {
    product_id: num(raw.product_id),
    product_name: str(raw.product_name) || str(raw.name),
    target_qty: num(raw.target_qty ?? raw.target ?? raw.objective_qty),
    theoretical_qty: num(raw.theoretical_qty ?? raw.current_qty ?? raw.actual_qty ?? raw.qty),
    price_unit: num(raw.price_unit ?? raw.price),
    last_visit: raw.last_visit != null ? str(raw.last_visit) : null,
  };
}

/**
 * GET consignación activa del cliente. Devuelve null si no tiene.
 * Query por partner_id (la consignación vive con el cliente).
 */
export async function getActiveConsignment(partnerId: number): Promise<ActiveConsignment | null> {
  const result = await getRest<unknown>(`${ENDPOINTS.myActive}?partner_id=${partnerId}`);
  const data = unwrap(result);
  if (!data) return null;
  const id = num(data.consignment_id ?? data.id);
  if (!id) return null; // sin consignación activa
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  return {
    consignment_id: id,
    partner_id: num(data.partner_id) || partnerId,
    state: str(data.state) || 'active',
    name: str(data.name),
    lines: (rawLines as unknown[])
      .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
      .map(normalizeLine),
    last_visit_date: data.last_visit_date != null ? str(data.last_visit_date) : null,
  };
}

interface CreateInput {
  operationId: string;
  partnerId: number;
  lines: CreateConsignmentLine[];
  employeeId: number | null;
  companyId: number | null;
  routePlanId: number | null;
}

/** POST crear consignación inicial (afecta inventario en backend, no cobra). */
export async function createConsignment(input: CreateInput): Promise<ConsignmentCreateResult> {
  const result = await postRest<unknown>(ENDPOINTS.create, {
    operation_id: input.operationId,
    partner_id: input.partnerId,
    lines: input.lines,
    employee_id: input.employeeId,
    company_id: input.companyId,
    route_plan_id: input.routePlanId,
    source: 'koldfield_consignment',
  });
  const data = unwrap(result) ?? {};
  const consignmentId = numOrNull(data.consignment_id ?? data.id);
  const name = str(data.name);
  if (consignmentId == null && !name) {
    throw new Error('El servidor no devolvió la consignación (sin folio ni id).');
  }
  logInfo('general', 'consignment_create', { partner_id: input.partnerId, lines: input.lines.length });
  return { ok: true, consignmentId, name };
}

interface VisitInput {
  operationId: string;
  consignmentId: number;
  lines: PhysicalCountLine[];
  employeeId: number | null;
  routePlanId: number | null;
}

/**
 * POST visita: manda conteo físico. El backend calcula vendido, crea venta/
 * cobro por el faltante y resurte al objetivo.
 */
export async function visitConsignment(input: VisitInput): Promise<ConsignmentVisitResult> {
  const result = await postRest<unknown>(ENDPOINTS.visit, {
    operation_id: input.operationId,
    consignment_id: input.consignmentId,
    lines: input.lines,
    employee_id: input.employeeId,
    route_plan_id: input.routePlanId,
  });
  const data = unwrap(result) ?? {};
  logInfo('general', 'consignment_visit', { consignment_id: input.consignmentId, lines: input.lines.length });
  return {
    ok: true,
    consignmentId: numOrNull(data.consignment_id ?? data.id) ?? input.consignmentId,
    chargedAmount: numOrNull(data.charged_amount ?? data.charge_total ?? data.amount),
    name: str(data.name),
  };
}

/** POST cierre: conteo físico final → cobra faltante + devuelve resto. */
export async function closeConsignment(input: VisitInput): Promise<ConsignmentCloseResult> {
  const result = await postRest<unknown>(ENDPOINTS.close, {
    operation_id: input.operationId,
    consignment_id: input.consignmentId,
    lines: input.lines,
    employee_id: input.employeeId,
    route_plan_id: input.routePlanId,
  });
  const data = unwrap(result) ?? {};
  logInfo('general', 'consignment_close', { consignment_id: input.consignmentId });
  return {
    ok: true,
    consignmentId: numOrNull(data.consignment_id ?? data.id) ?? input.consignmentId,
    chargedAmount: numOrNull(data.charged_amount ?? data.charge_total ?? data.amount),
    returnedTotal: numOrNull(data.returned_total ?? data.returned_qty ?? data.return_total),
    state: str(data.state) || 'closed',
  };
}
