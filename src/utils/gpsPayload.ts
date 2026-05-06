export function normalizeGpsTimestamp(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed;
  }

  return undefined;
}
