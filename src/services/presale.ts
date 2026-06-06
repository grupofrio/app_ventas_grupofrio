/**
 * Presale (Preventa) network service.
 *
 * ⚠️ BACKEND PENDING. There is NO presale endpoint yet — /sales/create always
 * confirms the order (action_confirm), so it cannot produce a quotation. Until
 * Sebas ships a presale endpoint (or a confirm=false flag on /sales/create),
 * this service stays GATED behind PRESALE_BACKEND_ENABLED so we NEVER simulate
 * success.
 *
 * When enabled, it POSTs to PRESALE_ENDPOINT with the payload from
 * presaleLogic.buildPresalePayload. Expected backend behavior:
 *   - create sale.order in 'draft' (quotation)
 *   - set commitment_date
 *   - do NOT confirm, do NOT deliver, do NOT touch route inventory
 *   - return { ok:true, data:{ sale_order_id, name } }
 */

import { postRest } from './api';
import { logInfo } from '../utils/logger';
import type { PresalePayload } from './presaleLogic';

/**
 * Flip to true ONLY when Sebas confirms the endpoint is deployed and the
 * contract matches. Keep false until then so the UI shows the blocked state.
 */
export const PRESALE_BACKEND_ENABLED = false;

/** Whether the backend supports presale to a lead (vs requiring a customer). */
export const PRESALE_LEAD_SUPPORTED = false;

/** Proposed endpoint — confirm exact path with Sebas before enabling. */
const PRESALE_ENDPOINT = 'gf/logistics/api/employee/presale/create';

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
  logInfo('general', 'presale_create', {
    partner_id: payload.partner_id,
    lines: payload.lines.length,
  });
  return {
    ok: true,
    saleOrderId: num(data.sale_order_id) ?? num(data.id),
    name: str(data.name) || str(data.sale_order_name),
  };
}
