/**
 * Types for Consignación (gf_consignment).
 *
 * ⚠️ CONTRATO ASUMIDO: el módulo backend gf_consignment NO es accesible desde
 * este repo, así que estas formas se derivan de la descripción funcional + las
 * convenciones de los endpoints /pwa-ruta existentes. TODOS los nombres de
 * campo deben confirmarse con Sebas (ver consignment.ts y el doc QA).
 *
 * Reglas de negocio (fuente de verdad = backend; la app muestra preliminar):
 *   vendido   = max(0, objetivo - existencia_física)
 *   resurtido = vendido
 *   importe   = vendido * precio
 */

export type ConsignmentState = 'active' | 'closed' | 'draft' | string;

/** Línea de una consignación activa (la devuelve my-active). */
export interface ConsignmentLine {
  product_id: number;
  product_name: string;
  target_qty: number;       // objetivo
  theoretical_qty: number;  // teórico/actual según backend
  price_unit: number;
  last_visit?: string | null;
}

/** Consignación activa del cliente. */
export interface ActiveConsignment {
  consignment_id: number;
  partner_id: number;
  state: ConsignmentState;
  name: string;
  lines: ConsignmentLine[];
  last_visit_date?: string | null;
}

/** Línea para crear consignación (objetivo + precio). */
export interface CreateConsignmentLine {
  product_id: number;
  target_qty: number;
  price_unit: number;
}

/** Línea de conteo físico (visita / cierre). */
export interface PhysicalCountLine {
  product_id: number;
  physical_qty: number;
}

/** Cálculo preliminar por línea (mostrado en la app; backend confirma). */
export interface ConsignmentLineCalc {
  product_id: number;
  product_name: string;
  target_qty: number;
  physical_qty: number;
  sold_qty: number;     // = max(0, target - physical)
  restock_qty: number;  // = sold
  price_unit: number;
  charge_amount: number; // = sold * price
}

export interface ConsignmentVisitTotals {
  soldTotal: number;
  chargeTotal: number;
  restockTotal: number;
}

export interface ConsignmentCreateResult {
  ok: boolean;
  consignmentId: number | null;
  name: string;
}

export interface ConsignmentVisitResult {
  ok: boolean;
  consignmentId: number | null;
  chargedAmount: number | null;
  name: string;
}

export interface ConsignmentCloseResult {
  ok: boolean;
  consignmentId: number | null;
  chargedAmount: number | null;
  returnedTotal: number | null;
  state: string;
}
