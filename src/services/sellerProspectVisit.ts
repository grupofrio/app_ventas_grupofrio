/**
 * Seller prospect visit — what the vendedor does in KoldField.
 *
 * A new store is not a loose crm.lead. The seller places a pin, the app
 * creates the prospect, and that same save becomes today's visit. Conversion
 * stays blocked without a phone or without that pin. GPS alone is not a pin.
 */

import type { GFStop } from '../types/plan';
import { buildProspectionPayload, type NewLeadForm } from './leadIntake.ts';
import type { CreateVirtualStopInput } from './virtualStopFactory';

export interface SellerPin {
  latitude: number;
  longitude: number;
}

export type ConvertBlock = 'phone' | 'pin' | 'lead_pending';

export function isUsableCoordinate(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number'
    && Number.isFinite(latitude)
    && typeof longitude === 'number'
    && Number.isFinite(longitude)
    && !(latitude === 0 && longitude === 0);
}

/** Coordinates already stored on the record count as the seller's pin. */
export function pinFromRecord(
  latitude: unknown,
  longitude: unknown,
): SellerPin | null {
  if (!isUsableCoordinate(latitude, longitude)) return null;
  return { latitude: latitude as number, longitude: longitude as number };
}

/**
 * Phone is required for a new prospect and for conversion.
 * Accepts a 10-digit MX number, with or without +52 / 521.
 */
export function prospectPhoneOrNull(value: string): string | null {
  const trimmed = (value ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  let national: string | null = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 12 && digits.startsWith('52')) national = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith('521')) national = digits.slice(3);
  if (!national || national[0] === '0' || national[0] === '1') return null;
  if (new Set(national).size === 1) return null;
  return `+52${national}`;
}

export function convertBlockMessage(block: ConvertBlock): string {
  switch (block) {
    case 'phone':
      return 'El teléfono es obligatorio para convertir a cliente.';
    case 'pin':
      return 'Coloca el pin en la puerta. La conversión no guarda el GPS del teléfono en silencio.';
    case 'lead_pending':
      return 'Este prospecto sigue pendiente de sincronizar. Cuando quede registrado, podrás convertirlo en esta misma visita.';
    default:
      return 'No se puede convertir este prospecto todavía.';
  }
}

export function convertBlockers(input: {
  phone: string;
  pinPlaced: boolean;
  leadId?: number | null;
  pendingLeadOperationId?: string | null;
  stopId: number;
}): ConvertBlock[] {
  const blocks: ConvertBlock[] = [];
  if (!prospectPhoneOrNull(input.phone)) blocks.push('phone');
  if (!input.pinPlaced) blocks.push('pin');

  const hasLead = typeof input.leadId === 'number' && input.leadId > 0;
  const hasRouteStop = input.stopId > 0;
  if (!hasLead && !hasRouteStop) blocks.push('lead_pending');
  return blocks;
}

/** Same sale screen a planned stop uses after the prospect is a customer. */
export function customerSaleRoute(stopId: number): string {
  return `/sale/${stopId}`;
}

export interface PreparedProspectVisit {
  payload: Record<string, unknown>;
  virtualStop: CreateVirtualStopInput;
}

export function prepareTodayProspectVisit(input: {
  form: NewLeadForm;
  pin: SellerPin | null;
  localCustomerId: number;
  leadId?: number | null;
  pendingLeadOperationId?: string | null;
  offrouteVisitId?: number | null;
}): { ok: true; visit: PreparedProspectVisit } | { ok: false; title: string; message: string } {
  const name = input.form.nombre.trim();
  if (!name) {
    return { ok: false, title: 'Falta nombre', message: 'El nombre del prospecto es obligatorio.' };
  }
  const phone = prospectPhoneOrNull(input.form.telefono);
  if (!phone) {
    return {
      ok: false,
      title: 'Falta teléfono',
      message: 'El teléfono es obligatorio (10 dígitos).',
    };
  }
  if (!input.pin || !isUsableCoordinate(input.pin.latitude, input.pin.longitude)) {
    return {
      ok: false,
      title: 'Falta el pin',
      message: 'Coloca el pin en la puerta. Puedes dejarlo en tu ubicación o arrastrarlo.',
    };
  }

  const form: NewLeadForm = { ...input.form, nombre: name, telefono: phone };
  const leadId = typeof input.leadId === 'number' && input.leadId > 0 ? input.leadId : null;
  const pendingLeadOperationId = leadId ? null : (input.pendingLeadOperationId ?? null);

  return {
    ok: true,
    visit: {
      payload: buildProspectionPayload(form, {
        latitude: input.pin.latitude,
        longitude: input.pin.longitude,
      }),
      virtualStop: {
        customerId: leadId ?? input.localCustomerId,
        customerName: name,
        entityType: 'lead',
        leadId,
        partnerId: null,
        offrouteVisitId: input.offrouteVisitId ?? null,
        customerLatitude: input.pin.latitude,
        customerLongitude: input.pin.longitude,
        street: form.direccion.trim() || null,
        phone,
        mobile: phone,
        pendingLeadOperationId,
      },
    },
  };
}

export function readCreatedLeadId(lead: Record<string, unknown> | null | undefined): number | null {
  if (!lead || typeof lead !== 'object') return null;
  const id = lead.id;
  return typeof id === 'number' && Number.isFinite(id) && id > 0 ? id : null;
}

export interface PendingLeadPatch {
  id: number;
  patch: Partial<GFStop>;
}

/** Attach the server lead to the visit created before sync finished. */
export function pendingLeadVisitPatches(
  stops: GFStop[],
  operationId: string,
  leadId: number,
): PendingLeadPatch[] {
  if (!operationId || !(leadId > 0)) return [];
  return stops
    .filter((stop) => stop._pendingLeadOperationId === operationId && stop._leadId !== leadId)
    .map((stop) => ({
      id: stop.id,
      patch: {
        _leadId: leadId,
        _pendingLeadOperationId: null,
        customer_id: stop.customer_id > 0 ? stop.customer_id : leadId,
      },
    }));
}
