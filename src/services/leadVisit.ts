import type { GFStop } from '../types/plan';

export interface LeadStageOption {
  id: number;
  name: string;
  sequence?: number;
}

export interface LeadUpsertResponse {
  id: number;
  stop?: Partial<GFStop> & { customer_mobile?: string };
  type?: string;
  stage_id?: [number, string] | number | false | null;
  partner_id?: [number, string] | number | false | null;
  contact_name?: string;
  phone?: string;
  email_from?: string;
  company_id?: [number, string] | number | false | null;
}

export function extractMany2oneId(
  value: [number, string] | number | false | null | undefined,
): number | null {
  if (Array.isArray(value) && typeof value[0] === 'number' && value[0] > 0) {
    return value[0];
  }
  if (typeof value === 'number' && value > 0) return value;
  return null;
}

export function getLeadPartnerId(stop: Pick<GFStop, '_entityType' | '_partnerId' | 'partner_id'>): number | null {
  if (stop._entityType !== 'lead') return null;
  if (typeof stop._partnerId === 'number' && stop._partnerId > 0) {
    return stop._partnerId;
  }
  return extractMany2oneId(stop.partner_id);
}

export function isLeadSellable(stop: Pick<GFStop, '_entityType' | '_partnerId' | 'partner_id'>): boolean {
  if (stop._entityType !== 'lead') return true;
  return getLeadPartnerId(stop) != null;
}

export function getLeadActionVisibility(
  stop: Pick<GFStop, '_entityType' | '_partnerId' | 'partner_id'>,
): {
  showData: boolean;
  showGift: boolean;
  showSale: boolean;
  showNoSale: boolean;
} {
  const isLead = stop._entityType === 'lead';
  if (!isLead) {
    return { showData: false, showGift: true, showSale: true, showNoSale: true };
  }

  const sellable = isLeadSellable(stop);
  return {
    showData: true,
    showGift: true,
    showSale: sellable,
    // BLD-20260424-BUGC: la "No Venta" es un evento de visita ("vine,
    // intenté, no fue posible"), NO una transacción comercial. No
    // requiere partner_id — el backend acepta el evento contra stop_id
    // o visit_id directamente. Bloquearlo obligaba a los operadores a
    // llenar Datos del lead con información falsa solo para poder
    // avanzar la ruta. Ahora siempre disponible para leads.
    showNoSale: true,
  };
}

export function applyLeadUpsertToStop(
  stop: GFStop,
  lead: LeadUpsertResponse,
): GFStop {
  const partnerId = extractMany2oneId(lead.partner_id);

  return {
    ...stop,
    phone: typeof lead.phone === 'string' ? lead.phone : stop.phone,
    mobile: typeof lead.stop?.customer_mobile === 'string' ? lead.stop.customer_mobile : stop.mobile,
    customer_latitude: typeof lead.stop?.customer_latitude === 'number' ? lead.stop.customer_latitude : stop.customer_latitude,
    customer_longitude: typeof lead.stop?.customer_longitude === 'number' ? lead.stop.customer_longitude : stop.customer_longitude,
    _entityType: 'lead',
    _leadId: typeof lead.id === 'number' ? lead.id : stop._leadId ?? null,
    _partnerId: partnerId,
    partner_id: lead.partner_id ?? stop.partner_id ?? (partnerId ? partnerId : null),
    customer_id: partnerId ?? stop.customer_id,
  };
}
