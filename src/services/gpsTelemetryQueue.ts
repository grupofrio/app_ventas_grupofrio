/**
 * GPS pings are telemetry. A 503 must not turn them into Fallidos that the
 * seller has to clear before liquidating.
 *
 * They retry with the normal backoff, then disappear: after GPS_MAX_ATTEMPTS
 * or when the point is older than GPS_STALE_MS. Dropping the row also
 * releases anything that was waiting on it (a missing dependency is met).
 */

export const GPS_MAX_ATTEMPTS = 3;
export const GPS_STALE_MS = 2 * 60 * 60 * 1000;

export interface GpsQueueCandidate {
  id: string;
  type: string;
  status: string;
  retries?: number;
  created_at?: number;
  dependsOn?: string[];
}

export function shouldSilentlyDropGpsItem(
  item: Pick<GpsQueueCandidate, 'type' | 'status' | 'retries' | 'created_at'>,
  now: number,
  limits?: { maxAttempts?: number; staleMs?: number },
): boolean {
  if (item.type !== 'gps') return false;
  if (item.status === 'done') return false;
  if (item.status === 'dead') return true;
  const maxAttempts = limits?.maxAttempts ?? GPS_MAX_ATTEMPTS;
  if ((item.retries ?? 0) >= maxAttempts) return true;
  const staleMs = limits?.staleMs ?? GPS_STALE_MS;
  const createdAt = typeof item.created_at === 'number' ? item.created_at : now;
  return now - createdAt > staleMs;
}

export function dropSilentGpsItems<T extends GpsQueueCandidate>(
  queue: readonly T[],
  now: number,
  limits?: { maxAttempts?: number; staleMs?: number },
): { queue: T[]; droppedIds: string[] } {
  const droppedIds = queue
    .filter((item) => shouldSilentlyDropGpsItem(item, now, limits))
    .map((item) => item.id);
  if (droppedIds.length === 0) return { queue: [...queue], droppedIds };
  const dropped = new Set(droppedIds);
  const next = queue
    .filter((item) => !dropped.has(item.id))
    .map((item) => {
      if (!item.dependsOn?.some((dependencyId) => dropped.has(dependencyId))) return item;
      const dependsOn = item.dependsOn.filter((dependencyId) => !dropped.has(dependencyId));
      return { ...item, dependsOn: dependsOn.length > 0 ? dependsOn : undefined };
    });
  return { queue: next, droppedIds };
}
