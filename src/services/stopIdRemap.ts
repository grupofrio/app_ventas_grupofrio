const STOP_ID_KEYS = [
  'stop_id',
  'route_stop_id',
  'gf_route_stop_id',
  'special_visit_stop_id',
] as const;

const remaps = new Map<number, number>();

function asPositiveStopId(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function readPositiveStopId(value: unknown, depth = 0): number | null {
  if (depth > 3 || !value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of STOP_ID_KEYS) {
    const stopId = asPositiveStopId(record[key]);
    if (stopId) return stopId;
  }
  const nested = readPositiveStopId(record.data, depth + 1);
  if (nested) return nested;
  return readPositiveStopId(record.visit, depth + 1);
}

export function rememberStopRemap(fromId: number, toId: number): void {
  if (fromId < 0 && toId > 0 && fromId !== toId) remaps.set(fromId, toId);
}

export function resolveStopId(stopId: number): number {
  return remaps.get(stopId) ?? stopId;
}

export function clearStopRemapsForTests(): void {
  remaps.clear();
}
