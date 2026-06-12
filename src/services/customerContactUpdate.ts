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

// Copy del aviso de captura (pantalla de parada). Centralizado para tests/wiring.
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

/** true si la parada ya tiene algún teléfono del cliente (phone o mobile).
 *  El campo de WhatsApp normalizado del bot queda fuera: ni se lee ni se escribe aquí. */
export function hasContactPhone(stop: Pick<GFStop, 'phone' | 'mobile'>): boolean {
  return Boolean((stop.phone ?? '').trim() || (stop.mobile ?? '').trim());
}

const SEQUENTIAL_NATIONALS = new Set([
  '1234567890',
  '0123456789',
  '0987654321',
  '9876543210',
]);

export type MxPhoneResult =
  | { ok: true; e164: string } // e164 === '' cuando viene vacío (permitido: el cliente puede no compartirlo)
  | { ok: false; error: string };

/**
 * Normaliza un teléfono mexicano a E.164 (+52 + 10 dígitos).
 * Acepta 10 dígitos, 52+10 y 521+10 (formato WhatsApp legado).
 * Rechaza longitudes inválidas, NIR imposibles (0/1) y números de relleno
 * (dígitos repetidos o secuencias tipo 1234567890).
 */
export function normalizeMxPhone(value: string): MxPhoneResult {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length === 0) {
    return { ok: true, e164: '' };
  }
  let national: string | null = null;
  if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 12 && digits.startsWith('52')) {
    national = digits.slice(2);
  } else if (digits.length === 13 && digits.startsWith('521')) {
    national = digits.slice(3);
  }
  if (!national) {
    return { ok: false, error: 'debe tener 10 dígitos (México).' };
  }
  if (national[0] === '0' || national[0] === '1') {
    return { ok: false, error: 'no parece un número mexicano válido (no puede iniciar en 0 o 1).' };
  }
  if (new Set(national).size === 1 || SEQUENTIAL_NATIONALS.has(national)) {
    return { ok: false, error: 'no parece un número real.' };
  }
  return { ok: true, e164: `+52${national}` };
}

/** Forma canónica para guardar/comparar: E.164 si es válido, texto limpio si no. */
function canonicalPhone(value: string): string {
  const result = normalizeMxPhone(value);
  return result.ok ? result.e164 : clean(value);
}

/** true si el valor nuevo representa OTRO número (cambios solo de formato no cuentan). */
export function phoneChanged(previous: string, next: string): boolean {
  return canonicalPhone(previous ?? '') !== canonicalPhone(next ?? '');
}

export function validateCustomerContactForm(form: CustomerContactForm): string | null {
  if (clean(form.name).length === 0) {
    return 'El nombre del cliente es obligatorio.';
  }
  const phoneCheck = normalizeMxPhone(form.phone);
  if (!phoneCheck.ok) {
    return `Teléfono: ${phoneCheck.error}`;
  }
  const mobileCheck = normalizeMxPhone(form.mobile);
  if (!mobileCheck.ok) {
    return `Móvil: ${mobileCheck.error}`;
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
    phone: optionalOdooValue(canonicalPhone(form.phone)),
    mobile: optionalOdooValue(canonicalPhone(form.mobile)),
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
    phone: canonicalPhone(form.phone),
    mobile: canonicalPhone(form.mobile),
    email: clean(form.email),
  };
}
