import type { GFStop } from '../types/plan';

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normalizePlanStopPayload(raw: Record<string, unknown>): GFStop {
  const stop = { ...raw } as unknown as GFStop;
  const pricelistId = asPositiveNumber(raw.pricelist_id);
  const pricelistName = asNonEmptyString(raw.pricelist_name);

  return {
    ...stop,
    _pricelistId: stop._pricelistId ?? pricelistId,
    _pricelistName: stop._pricelistName ?? pricelistName,
  };
}
