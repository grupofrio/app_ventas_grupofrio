/**
 * Types for Consignación (gf_consignment) — alineados al CONTRATO REAL de Sebas.
 *
 * Reglas (fuente de verdad = backend; la app muestra preliminar):
 *   sold_qty  = max(0, target_qty - physical_qty)
 *   restock   = sold_qty
 *   importe   = sold_qty * price_unit
 * La respuesta NO trae sold_qty/folio/importe — la app no depende de ellos.
 */

export type ConsignmentState = 'active' | 'closed' | 'draft' | string;

export type ConsignmentPaymentMethod = 'cash';

/** Línea tal como la devuelve el backend (my-active / create / visit / close). */
export interface ConsignmentLine {
  line_id: number;
  product_id: number;
  product_name: string;
  product_uom_id: number | null;
  price_unit: number;
  target_qty: number;
  current_qty: number;
  last_count_qty: number;
  active: boolean;
}

/** Consignación (objeto `data.consignment`). */
export interface ActiveConsignment {
  id: number;
  name: string;
  partner_id: number;
  partner_name: string;
  company_id: number | null;
  employee_id: number | null;
  route_plan_id: number | null;
  vehicle_id: number | null;
  mobile_location_id: number | null;
  state: ConsignmentState;
  date_opened: string;
  last_visit_date: string;
  date_closed: string;
  lines: ConsignmentLine[];
}

/** Línea para crear consignación (objetivo + precio cliente). */
export interface CreateConsignmentLine {
  product_id: number;
  target_qty: number;
  price_unit: number;
}

/** Conteo físico para visit/close (incluye target+precio, el backend recalcula). */
export interface ConsignmentCountLine {
  product_id: number;
  physical_qty: number;
  target_qty: number;
  price_unit: number;
}

/** Cálculo preliminar por línea (mostrado en la app; backend confirma). */
export interface ConsignmentLineCalc {
  product_id: number;
  product_name: string;
  target_qty: number;
  physical_qty: number;
  sold_qty: number;
  restock_qty: number;
  price_unit: number;
  charge_amount: number;
}

export interface ConsignmentVisitTotals {
  soldTotal: number;
  chargeTotal: number;
  restockTotal: number;
}

/** Resultado de create/visit/close: devuelve el objeto consignment + message. */
export interface ConsignmentMutationResult {
  ok: boolean;
  message: string;
  consignment: ActiveConsignment | null;
}
