import type { GFStop } from '../types/plan';

type InterestLevel = 'high' | 'medium' | 'low';
type FreezerAnswer = 'yes' | 'no';

interface PostvisitFormValues {
  contactName: string;
  phone: string;
  email: string;
  competitor: string;
  freezer: FreezerAnswer;
  interestLevel: InterestLevel;
  notes: string;
}

interface BuildPostvisitPayloadInput {
  stop: Pick<GFStop, 'id' | 'customer_name' | '_entityType' | '_leadId' | '_partnerId' | 'partner_id'>;
  form: PostvisitFormValues;
  stageId: number;
}

function mapInterestToPriority(level: InterestLevel): '1' | '2' | '3' {
  if (level === 'high') return '3';
  if (level === 'medium') return '2';
  return '1';
}

function buildDescription(form: PostvisitFormValues): string {
  return [
    `Competidor: ${form.competitor || 'No especificado'}`,
    `Freezer: ${form.freezer === 'yes' ? 'Sí' : 'No'}`,
    `Interés: ${form.interestLevel}`,
    `Notas: ${form.notes || 'Sin notas'}`,
  ].join('\n');
}

function extractLeadPartnerId(
  stop: Pick<GFStop, '_entityType' | '_partnerId' | 'partner_id'>,
): number | null {
  if (stop._entityType !== 'lead') return null;
  if (typeof stop._partnerId === 'number' && stop._partnerId > 0) {
    return stop._partnerId;
  }
  const value = stop.partner_id;
  if (Array.isArray(value) && typeof value[0] === 'number' && value[0] > 0) {
    return value[0];
  }
  if (typeof value === 'number' && value > 0) return value;
  return null;
}

export function buildPostvisitPayload({ stop, form, stageId }: BuildPostvisitPayloadInput) {
  return {
    stop_id: stop.id,
    lead_id: stop._entityType === 'lead' ? stop._leadId || null : null,
    partner_id: extractLeadPartnerId(stop),
    customer_name: stop.customer_name,
    stage_id: stageId,
    contact_name: form.contactName || undefined,
    phone: form.phone || undefined,
    email_from: form.email || undefined,
    priority: mapInterestToPriority(form.interestLevel),
    competitor: form.competitor || undefined,
    freezer: form.freezer,
    interest_level: form.interestLevel,
    notes: form.notes || undefined,
    description: buildDescription(form),
  };
}
