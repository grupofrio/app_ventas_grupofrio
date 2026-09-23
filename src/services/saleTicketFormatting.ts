import { DEFAULT_OPERATION_TIME_ZONE } from '../utils/localDate.ts';

export const SALE_TICKET_DEFAULT_SELLER = 'Vendedor no especificado';

export function formatQuantity(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
}

export function normalizeSellerName(value: string | undefined): string {
  const normalized = (value ?? '').trim();
  return normalized || SALE_TICKET_DEFAULT_SELLER;
}

export function formatTicketCurrency(amount: number): string {
  const safe = typeof amount === 'number' && !Number.isNaN(amount) ? amount : 0;
  return `$${safe.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatQuantityAndUnitPrice(quantity: number, unitPrice: number): string {
  return `${formatQuantity(quantity)} x ${formatTicketCurrency(unitPrice)}`;
}

export function formatTotalKg(totalKg: number): string {
  return `${totalKg.toFixed(1)} kg`;
}

export function formatTicketDate(value: string): string {
  // Odoo returns UTC datetimes without a zone; never interpret those in
  // the device's local timezone. Preserve explicit offsets from other sources.
  const trimmed = value.trim();
  const utcValue = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const date = new Date(utcValue);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-MX', {
    // CDMX ended DST in 2022 (IANA tzdb 2022f). Older Android timezone
    // databases still apply summer UTC-5. Fixed UTC-6 handles current tickets;
    // keep historical rules for instants before the final 2022 transition.
    timeZone: date.getTime() >= Date.parse('2022-10-30T07:00:00Z')
      ? 'Etc/GMT+6'
      : DEFAULT_OPERATION_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
