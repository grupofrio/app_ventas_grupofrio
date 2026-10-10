import { normalizeGpsTimestamp } from '../utils/gpsPayload.ts';

export function capturedInstantIso(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (!payload) return null;
  const explicit = payload.client_checkin_at
    ?? payload.client_checkout_at
    ?? payload.captured_at;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  return normalizeGpsTimestamp(payload.timestamp) ?? null;
}

export function buildCheckinRequestBody(input: {
  stopId: number;
  latitude: number;
  longitude: number;
  capturedAt?: string | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    stop_id: input.stopId,
    latitude: input.latitude,
    longitude: input.longitude,
  };
  if (typeof input.capturedAt === 'string' && input.capturedAt.trim()) {
    body.client_checkin_at = input.capturedAt.trim();
  }
  return body;
}

export function withCheckoutCapturedAt<T extends Record<string, unknown>>(
  body: T,
  capturedAt?: string | null,
): T {
  if (typeof capturedAt !== 'string' || !capturedAt.trim()) return body;
  return { ...body, client_checkout_at: capturedAt.trim() };
}

/** GPS row captured with the visit, replayed immediately before check-in/out. */
export function capturedGpsBatchBody(
  payload: Record<string, unknown> | null | undefined,
): { records: Array<Record<string, unknown>> } | null {
  if (!payload) return null;
  const latitude = payload.latitude;
  const longitude = payload.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  const timestamp = capturedInstantIso(payload);
  const record: Record<string, unknown> = {
    latitude,
    longitude,
    accuracy: typeof payload.accuracy === 'number' && Number.isFinite(payload.accuracy)
      ? payload.accuracy
      : 0,
  };
  if (timestamp) record.timestamp = timestamp;
  return { records: [record] };
}
