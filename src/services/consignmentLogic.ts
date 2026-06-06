/**
 * Pure helpers for Consignación. No network, no RN — unit-testable.
 *
 * Reglas (preliminar en app; el backend es la fuente de verdad):
 *   vendido   = max(0, objetivo - existencia_física)
 *   resurtido = vendido
 *   importe   = vendido * precio
 */

import type {
  ConsignmentLine,
  ConsignmentLineCalc,
  ConsignmentVisitTotals,
  CreateConsignmentLine,
  PhysicalCountLine,
} from '../types/consignment';
import type { SaleLineItem } from '../stores/useVisitStore';

function n(v: unknown): number {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : 0;
}

/** Cálculo preliminar de una línea dado el conteo físico. */
export function computeLineCalc(
  line: ConsignmentLine,
  physicalQty: number,
): ConsignmentLineCalc {
  const target = n(line.target_qty);
  const physical = Math.max(0, n(physicalQty));
  const sold = Math.max(0, target - physical);
  const price = n(line.price_unit);
  return {
    product_id: line.product_id,
    product_name: line.product_name,
    target_qty: target,
    physical_qty: physical,
    sold_qty: sold,
    restock_qty: sold,
    price_unit: price,
    charge_amount: Math.round(sold * price * 100) / 100,
  };
}

/** Totales preliminares de una visita (suma de líneas). */
export function computeVisitTotals(calcs: ConsignmentLineCalc[]): ConsignmentVisitTotals {
  return calcs.reduce<ConsignmentVisitTotals>(
    (acc, c) => ({
      soldTotal: acc.soldTotal + c.sold_qty,
      chargeTotal: Math.round((acc.chargeTotal + c.charge_amount) * 100) / 100,
      restockTotal: acc.restockTotal + c.restock_qty,
    }),
    { soldTotal: 0, chargeTotal: 0, restockTotal: 0 },
  );
}

/** Valor consignado total al crear (objetivo * precio). */
export function computeConsignedValue(lines: CreateConsignmentLine[]): number {
  return Math.round(lines.reduce((s, l) => s + n(l.target_qty) * n(l.price_unit), 0) * 100) / 100;
}

/** Mapea el carrito (SaleLineItem) → líneas de creación (qty = objetivo). */
export function cartToCreateLines(cart: SaleLineItem[]): CreateConsignmentLine[] {
  return cart
    .filter((l) => l.productId > 0 && l.qty > 0)
    .map((l) => ({
      product_id: l.productId,
      target_qty: l.qty,
      price_unit: Number.isFinite(l.price) ? l.price : 0,
    }));
}

export type CreateValidation =
  | { ok: true; lines: CreateConsignmentLine[] }
  | { ok: false; reason: string };

/** Valida las líneas de creación. */
export function validateCreateLines(cart: SaleLineItem[]): CreateValidation {
  const lines = cartToCreateLines(cart);
  if (lines.length === 0) return { ok: false, reason: 'Agrega al menos un producto.' };
  if (lines.some((l) => l.target_qty <= 0)) return { ok: false, reason: 'La cantidad objetivo debe ser mayor a 0.' };
  return { ok: true, lines };
}

/**
 * Construye las líneas de conteo físico desde el mapa {product_id: texto}.
 * Acepta vacío como 0. Rechaza valores no numéricos o negativos.
 */
export type PhysicalValidation =
  | { ok: true; lines: PhysicalCountLine[] }
  | { ok: false; reason: string };

export function buildPhysicalLines(
  activeLines: ConsignmentLine[],
  input: Record<number, string>,
): PhysicalValidation {
  const lines: PhysicalCountLine[] = [];
  for (const line of activeLines) {
    const raw = input[line.product_id];
    if (raw === undefined || raw === '') {
      return { ok: false, reason: `Captura la existencia física de "${line.product_name}".` };
    }
    const qty = parseFloat(raw);
    if (!Number.isFinite(qty) || qty < 0) {
      return { ok: false, reason: `Existencia física inválida en "${line.product_name}".` };
    }
    lines.push({ product_id: line.product_id, physical_qty: qty });
  }
  if (lines.length === 0) return { ok: false, reason: 'No hay líneas para contar.' };
  return { ok: true, lines };
}
