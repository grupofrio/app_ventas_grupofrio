/**
 * Secure Field prospect → customer conversion helpers.
 * Convert is online-only and uses dedicated /lead/convert (not upsert).
 */

import type { GFStop } from '../types/plan';

export type ProspectConvertStatus =
  | 'converted'
  | 'already_converted'
  | 'REVIEW_REQUIRED_DUPLICATE';

export interface ProspectConvertCandidate {
  partner_id: number;
  display_name?: string;
  phone?: string | null;
  address_summary?: string | null;
  distance_m?: number | null;
  match_reasons?: string[];
}

export interface ProspectConvertResult {
  status: ProspectConvertStatus | string;
  lead_id?: number;
  partner_id?: number;
  partner_name?: string;
  candidates?: ProspectConvertCandidate[];
  stop?: Record<string, unknown>;
}

function asPositiveId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'number' && value[0] > 0) return value[0];
  return null;
}

export function isReviewRequiredDuplicateError(
  error: unknown,
): error is Error & { code: string; data?: ProspectConvertResult } {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  if (code === 'review_required_duplicate' || code === 'REVIEW_REQUIRED_DUPLICATE') {
    return true;
  }
  const data = (error as Error & { data?: { status?: string } }).data;
  return data?.status === 'REVIEW_REQUIRED_DUPLICATE';
}

export function reviewRequiredMessage(error: Error & { data?: ProspectConvertResult }): string {
  const candidates = error.data?.candidates;
  const count = Array.isArray(candidates) ? candidates.length : 0;
  const base =
    error.message?.trim() ||
    'Encontramos un posible cliente existente. La conversión requiere revisión.';
  if (count <= 0) return base;
  const names = candidates!
    .slice(0, 3)
    .map((c) => (typeof c.display_name === 'string' ? c.display_name.trim() : ''))
    .filter(Boolean);
  if (names.length === 0) return `${base}\n\nCandidatos detectados: ${count}.`;
  return `${base}\n\nPosibles coincidencias:\n• ${names.join('\n• ')}`;
}

/** Apply a successful convert/already_converted payload onto the local stop. */
export function applyLeadConvertToStop(
  stop: GFStop,
  result: ProspectConvertResult,
): GFStop {
  const partnerFromStop = asPositiveId(
    (result.stop as { partner_id?: unknown } | undefined)?.partner_id,
  );
  const partnerId = asPositiveId(result.partner_id) ?? partnerFromStop;

  const partnerName =
    typeof result.partner_name === 'string' && result.partner_name.trim()
      ? result.partner_name.trim()
      : stop.customer_name;

  const leadId =
    typeof result.lead_id === 'number' && result.lead_id > 0
      ? result.lead_id
      : stop._leadId ?? null;

  return {
    ...stop,
    _entityType: 'lead',
    _leadId: leadId,
    _partnerId: partnerId,
    partner_id: partnerId ?? stop.partner_id ?? null,
    customer_id: partnerId ?? stop.customer_id,
    customer_name: partnerName,
  };
}

/** Seller-facing sync queue labels for prospection items (never expose operation_id). */
export function describeProspectionSyncLabel(
  item: { status: string; payload?: Record<string, unknown> },
): string {
  const isNewProspect = item.payload?._source === 'nuevo_lead_ruta';
  if (item.status === 'done') {
    return isNewProspect ? 'Prospecto registrado' : 'Datos de prospecto sincronizados';
  }
  if (item.status === 'error' || item.status === 'dead') {
    return isNewProspect
      ? 'Prospecto con error de sincronización'
      : 'Datos de prospecto con error';
  }
  return isNewProspect
    ? 'Prospecto pendiente de sincronizar'
    : 'Datos de prospecto pendientes';
}
