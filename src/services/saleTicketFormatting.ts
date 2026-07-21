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

export function formatTicketDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
