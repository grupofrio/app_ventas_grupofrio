/** Read one row from POST pricing/by_partner without pulling the HTTP client. */

export function readEmployeePriceProductId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : null;
  }
  if (Array.isArray(value) && typeof value[0] === 'number' && Number.isFinite(value[0]) && value[0] > 0) {
    return value[0];
  }
  return null;
}

export function readEmployeePriceAmount(row: Record<string, unknown>): number | null {
  const raw = row.price_unit ?? row.price ?? row.lst_price;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw.trim()))) {
    return Number(raw.trim());
  }
  return null;
}
