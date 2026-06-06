/**
 * Pure helpers for Preventa (presale). No network, no RN — unit-testable.
 *
 * Business rules (approved):
 *  - Presale creates an Odoo QUOTATION (sale.order in draft), NOT a confirmed
 *    sale. It carries a delivery date (commitment_date), no payment, no
 *    checkout, no route inventory impact, no liquidation.
 *  - MVP prioritizes existing customers; leads only if backend supports it.
 */

import type { SaleLineItem } from '../stores/useVisitStore';

export interface PresaleLine {
  product_id: number;
  quantity: number;
  price_unit: number;
}

export interface PresalePayloadInput {
  operationId: string;
  partnerId: number | null;
  leadId: number | null;
  commitmentDate: string; // YYYY-MM-DD
  cart: SaleLineItem[];
  employeeId: number | null;
  companyId: number | null;
  routePlanId: number | null;
}

export interface PresalePayload {
  operation_id: string;
  partner_id: number | null;
  lead_id: number | null;
  commitment_date: string;
  lines: PresaleLine[];
  employee_id: number | null;
  company_id: number | null;
  route_plan_id: number | null;
  source: 'koldfield_presale';
}

/** Map the shared cart (SaleLineItem) into presale order lines. */
export function cartToPresaleLines(cart: SaleLineItem[]): PresaleLine[] {
  return cart
    .filter((l) => l.productId > 0 && l.qty > 0)
    .map((l) => ({
      product_id: l.productId,
      quantity: l.qty,
      price_unit: Number.isFinite(l.price) ? l.price : 0,
    }));
}

/** Cart total (sin IVA) — mirrors useVisitStore.saleSubtotal. */
export function computeCartTotal(cart: SaleLineItem[]): number {
  return cart.reduce((sum, l) => sum + (Number.isFinite(l.price) ? l.price : 0) * l.qty, 0);
}

/**
 * Validate a delivery date string (YYYY-MM-DD). Must be a real date and not
 * in the past relative to `todayIso`. Returns null if valid, else a reason.
 */
export function validateDeliveryDate(date: string, todayIso: string): string | null {
  if (!date) return 'Selecciona la fecha de entrega.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Fecha inválida (usa AAAA-MM-DD).';
  const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return 'Fecha inexistente.';
  }
  if (date < todayIso) return 'La fecha de entrega no puede ser en el pasado.';
  return null;
}

/** Add N days to a YYYY-MM-DD date (local), returning YYYY-MM-DD. */
export function addDaysIso(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export type PresaleValidation =
  | { ok: true; payload: PresalePayload }
  | { ok: false; reason: string };

/**
 * Build + validate the presale payload. Enforces: a customer (partner) is
 * required in the MVP unless the backend allows leads; at least one line; a
 * valid delivery date.
 */
export function buildPresalePayload(
  input: PresalePayloadInput,
  opts: { todayIso: string; allowLead: boolean },
): PresaleValidation {
  if (!input.partnerId && !input.leadId) {
    return { ok: false, reason: 'Selecciona un cliente.' };
  }
  if (!input.partnerId && input.leadId && !opts.allowLead) {
    return {
      ok: false,
      reason: 'Este prospecto debe convertirse a cliente antes de hacer preventa.',
    };
  }
  const lines = cartToPresaleLines(input.cart);
  if (lines.length === 0) {
    return { ok: false, reason: 'Agrega al menos un producto.' };
  }
  const dateError = validateDeliveryDate(input.commitmentDate, opts.todayIso);
  if (dateError) return { ok: false, reason: dateError };

  return {
    ok: true,
    payload: {
      operation_id: input.operationId,
      partner_id: input.partnerId,
      lead_id: input.leadId,
      commitment_date: input.commitmentDate,
      lines,
      employee_id: input.employeeId,
      company_id: input.companyId,
      route_plan_id: input.routePlanId,
      source: 'koldfield_presale',
    },
  };
}
