/**
 * Presale (Preventa) network service.
 *
 * BACKEND LIVE (Sebas, 2026-06): POST /pwa-ruta/presale-create crea una
 * cotización sale.order en estado 'draft', reusando la lógica de venta
 * (cliente, líneas, pricelist, compañía, empleado, almacén/contexto de ruta,
 * analíticas, operation_id/idempotencia), guarda commitment_date, y NO
 * confirma, NO crea/valida entrega, NO toca inventario de ruta, NO entra a
 * corte/liquidación. El plan sólo resuelve contexto/almacén (la cotización
 * NO se enlaza a gf_route_plan_id/gf_route_stop_id). Leads bloqueados en MVP.
 *
 * Respuesta: { ok:true, data:{ sale_order_id, name } }.
 * postRest lanza en ok:false / HTTP>=400 (envelope, fix #16) → sin falso éxito.
 */

import { postRest } from './api';
import { logInfo } from '../utils/logger';
import type { PresalePayload } from './presaleLogic';

/** Backend de preventa habilitado (endpoint /pwa-ruta/presale-create live). */
export const PRESALE_BACKEND_ENABLED = true;

/** El backend MVP NO soporta preventa a lead — quedan bloqueados con mensaje. */
export const PRESALE_LEAD_SUPPORTED = false;

/** Endpoint real (confirmado por Sebas). pwa-ruta usa base relativa. */
const PRESALE_ENDPOINT = 'pwa-ruta/presale-create';

export interface PresaleResult {
  ok: boolean;
  saleOrderId: number | null;
  name: string;
}

export class PresaleNotEnabledError extends Error {
  constructor() {
    super('Preventa pendiente de habilitar en backend.');
    this.name = 'PresaleNotEnabledError';
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Create a presale quotation. Throws PresaleNotEnabledError when the backend
 * isn't enabled (UI must handle and show the blocked message — NO fake folio).
 * When enabled, postRest throws on functional error (envelope ok:false).
 */
export async function createPresale(payload: PresalePayload): Promise<PresaleResult> {
  if (!PRESALE_BACKEND_ENABLED) {
    throw new PresaleNotEnabledError();
  }
  const result = await postRest<unknown>(PRESALE_ENDPOINT, payload as unknown as Record<string, unknown>);
  const data = (result && typeof result === 'object'
    ? ((result as Record<string, unknown>).data ?? result)
    : {}) as Record<string, unknown>;

  const saleOrderId = num(data.sale_order_id) ?? num(data.id);
  const name = str(data.name) || str(data.sale_order_name);

  // Respuesta malformada (200 ok pero sin folio ni id) → NO simular éxito.
  if (saleOrderId == null && !name) {
    throw new Error('El servidor no devolvió la cotización (sin folio ni id).');
  }

  logInfo('general', 'presale_create', {
    partner_id: payload.partner_id,
    lines: payload.lines.length,
    sale_order_id: saleOrderId,
  });
  return { ok: true, saleOrderId, name };
}
