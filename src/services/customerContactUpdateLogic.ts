import type { GFStop } from '../types/plan';

export interface CustomerContactForm {
  name: string;
  contactName: string;
  phone: string;
  mobile: string;
  email: string;
}

export const MISSING_PHONE_NOTICE =
  'Este cliente no tiene teléfono registrado. Pídele de favor su WhatsApp y captúralo en Editar cliente.';
export const MISSING_PHONE_CTA_LABEL = 'Capturar teléfono';

function clean(value: string): string {
  return value.trim();
}

function optionalOdooValue(value: string): string | false {
  const trimmed = clean(value);
  return trimmed.length > 0 ? trimmed : false;
}

export function hasContactPhone(stop: Pick<GFStop, 'phone' | 'mobile'>): boolean {
  return Boolean((stop.phone ?? '').trim() || (stop.mobile ?? '').trim());
}

const SEQUENTIAL_NATIONALS = new Set(['1234567890', '0123456789', '0987654321', '9876543210']);

export type MxPhoneResult = { ok: true; e164: string } | { ok: false; error: string };

export function normalizeMxPhone(value: string): MxPhoneResult {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length === 0) return { ok: true, e164: '' };
  let national: string | null = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 12 && digits.startsWith('52')) national = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith('521')) national = digits.slice(3);
  if (!national) return { ok: false, error: 'debe tener 10 dígitos (México).' };
  if (national[0] === '0' || national[0] === '1') {
    return { ok: false, error: 'no parece un número mexicano válido (no puede iniciar en 0 o 1).' };
  }
  if (new Set(national).size === 1 || SEQUENTIAL_NATIONALS.has(national)) {
    return { ok: false, error: 'no parece un número real.' };
  }
  return { ok: true, e164: `+52${national}` };
}

function canonicalPhone(value: string): string {
  const result = normalizeMxPhone(value);
  return result.ok ? result.e164 : clean(value);
}

export function phoneChanged(previous: string, next: string): boolean {
  return canonicalPhone(previous ?? '') !== canonicalPhone(next ?? '');
}

export function validateCustomerContactForm(form: CustomerContactForm): string | null {
  if (clean(form.name).length === 0) return 'El nombre del cliente es obligatorio.';
  const phoneCheck = normalizeMxPhone(form.phone);
  if (!phoneCheck.ok) return `Teléfono: ${phoneCheck.error}`;
  const mobileCheck = normalizeMxPhone(form.mobile);
  if (!mobileCheck.ok) return `Móvil: ${mobileCheck.error}`;
  return null;
}

export interface EmployeeCustomerContactUpdatePayload extends Record<string, unknown> {
  partner_id: number;
  values: { name: string; phone: string | false; mobile: string | false; email: string | false };
}

export function buildCustomerContactUpdatePayload(
  partnerId: number,
  form: CustomerContactForm,
): EmployeeCustomerContactUpdatePayload {
  return {
    partner_id: partnerId,
    values: {
      name: clean(form.name),
      phone: optionalOdooValue(canonicalPhone(form.phone)),
      mobile: optionalOdooValue(canonicalPhone(form.mobile)),
      email: optionalOdooValue(form.email),
    },
  };
}

/** Rebuilds queued data into the exact allowlisted employee REST contract. */
export function normalizeEmployeeCustomerContactUpdate(
  payload: Record<string, unknown>,
): EmployeeCustomerContactUpdatePayload {
  const partnerId = payload.partner_id;
  const values = payload.values;
  if (!Number.isInteger(partnerId) || (partnerId as number) <= 0 || !values || typeof values !== 'object') {
    throw new Error('customer_update requires a valid partner_id and contact values.');
  }
  const data = values as Record<string, unknown>;
  const name = data.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('customer_update requires a customer name.');
  }
  const optional = (field: 'phone' | 'mobile' | 'email'): string | false => {
    const value = data[field];
    if (typeof value === 'string' || value === false) return value;
    throw new Error(`customer_update has an invalid ${field}.`);
  };
  return {
    partner_id: partnerId as number,
    values: {
      name,
      phone: optional('phone'),
      mobile: optional('mobile'),
      email: optional('email'),
    },
  };
}

export function buildCustomerContactStopPatch(form: CustomerContactForm): Partial<GFStop> {
  return {
    customer_name: clean(form.name),
    contact_name: clean(form.contactName),
    phone: canonicalPhone(form.phone),
    mobile: canonicalPhone(form.mobile),
    email: clean(form.email),
  };
}
