import type { GFStop } from '../types/plan';

export interface CustomerContactForm {
  name: string;
  contactName: string;
  phone: string;
  mobile: string;
  email: string;
}

const CUSTOMER_CONTACT_SYNC_FIELDS = [
  'name',
  'phone',
  'mobile',
  'email',
] as const;

function clean(value: string): string {
  return value.trim();
}

function optionalOdooValue(value: string): string | false {
  const trimmed = clean(value);
  return trimmed.length > 0 ? trimmed : false;
}

export function validateCustomerContactForm(form: CustomerContactForm): string | null {
  if (clean(form.name).length === 0) {
    return 'El nombre del cliente es obligatorio.';
  }
  return null;
}

export function buildCustomerContactUpdatePayload(
  partnerId: number,
  form: CustomerContactForm,
): Record<string, string | number | false> {
  return {
    id: partnerId,
    name: clean(form.name),
    contact_name: optionalOdooValue(form.contactName),
    phone: optionalOdooValue(form.phone),
    mobile: optionalOdooValue(form.mobile),
    email: optionalOdooValue(form.email),
  };
}

export function buildCustomerContactOdooWriteArgs(
  payload: Record<string, unknown>,
): [[number], Record<string, string | false>] {
  const id = Number(payload.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('customer_update requires a valid partner id.');
  }

  const dict: Record<string, string | false> = {};
  for (const field of CUSTOMER_CONTACT_SYNC_FIELDS) {
    const value = payload[field];
    if (typeof value === 'string' || value === false) {
      dict[field] = value;
    }
  }

  return [[id], dict];
}

export async function syncCustomerContactUpdate(
  payload: Record<string, unknown>,
): Promise<boolean> {
  const args = buildCustomerContactOdooWriteArgs(payload);
  const { odooRpc } = await import('./odooRpc');
  return await odooRpc<boolean>('res.partner', 'write', args);
}

export function buildCustomerContactStopPatch(form: CustomerContactForm): Partial<GFStop> {
  return {
    customer_name: clean(form.name),
    contact_name: clean(form.contactName),
    phone: clean(form.phone),
    mobile: clean(form.mobile),
    email: clean(form.email),
  };
}
