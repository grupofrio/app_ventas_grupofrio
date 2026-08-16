/**
 * BLD-20260404-008 — Client event timestamp metadata.
 *
 * Captures client-side timing + device + op uuid so that operations
 * synced to the backend can carry trustworthy "when it actually happened"
 * information, independent of when they reach Odoo.
 *
 * BACKWARD COMPATIBILITY RULES (very important):
 *   1. This module NEVER mutates existing payloads in place.
 *   2. Attachment to outgoing requests is gated by a feature flag
 *      (`CLIENT_EVENT_META_ENABLED`) which defaults to `false`.
 *   3. When the flag is OFF, the meta is still captured and persisted
 *      in the sync queue item so that it is available when backend
 *      support lands and the flag is flipped ON — no code change needed.
 *   4. When the flag is ON, the meta is attached as a single namespaced
 *      sibling key (`_client_meta`) at the payload root, so any backend
 *      controller that extracts named fields explicitly will simply
 *      ignore it and keep working.
 *   5. Meta is never injected into server-owned records; bounded controllers
 *      accept it only as a sibling payload key.
 *
 * Fields produced (Sprint 3 P1 naming):
 *   - x_client_event_at   : ISO 8601 UTC capture time
 *   - x_client_event_tz   : IANA tz as reported by the device
 *   - x_client_op_uuid    : same value as the sync queue item id
 *                           (idempotency key for the backend)
 *   - x_client_device_id  : stable per-install pseudo-id (NO PII)
 *   - x_client_schema     : version tag so backend can evolve safely
 */

import * as SecureStore from 'expo-secure-store';

// Feature flag — default OFF. Flip to `true` only after backend endpoints
// accept `_client_meta` safely. See BLD-008-012-architecture.md.
export const CLIENT_EVENT_META_ENABLED = false;

export const CLIENT_EVENT_SCHEMA = 'client-meta-1';

const DEVICE_ID_KEY = 'kf_client_device_id';
let _cachedDeviceId: string | null = null;

/** Generate a RFC 4122 version-4 UUID for client idempotency keys. */
export function createUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Returns a stable pseudo-id for this device/install. No PII, no IMEI,
 * no MAC — just a locally-generated UUID persisted in SecureStore.
 * Best-effort: falls back to an in-memory ephemeral id if SecureStore
 * is unreachable so that we never block the caller.
 */
export async function getDeviceId(): Promise<string> {
  if (_cachedDeviceId) return _cachedDeviceId;
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (stored) {
      _cachedDeviceId = stored;
      return stored;
    }
    const fresh = createUuidV4();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, fresh);
    _cachedDeviceId = fresh;
    return fresh;
  } catch {
    // Fallback: non-persistent but non-crashing.
    if (!_cachedDeviceId) _cachedDeviceId = `eph-${createUuidV4()}`;
    return _cachedDeviceId;
  }
}

export interface ClientEventMeta {
  x_client_event_at: string;
  x_client_event_tz: string;
  x_client_op_uuid: string;
  x_client_device_id: string;
  x_client_schema: string;
}

/**
 * Build the metadata object for a client-initiated event.
 * Safe to call from anywhere; never throws.
 */
export async function makeClientEventMeta(opUuid: string): Promise<ClientEventMeta> {
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    tz = 'UTC';
  }
  const deviceId = await getDeviceId();
  return {
    x_client_event_at: new Date().toISOString(),
    x_client_event_tz: tz,
    x_client_op_uuid: opUuid,
    x_client_device_id: deviceId,
    x_client_schema: CLIENT_EVENT_SCHEMA,
  };
}

/**
 * Attach client meta to an outgoing payload as a single namespaced
 * sibling key. Used by REST endpoint callers (gf_logistics_ops).
 *
 * - If the feature flag is OFF, returns the payload untouched.
 * - Never mutates the input.
 * - Never injects into reserved Odoo keys (`dict`, `model`, `method`).
 */
export function attachClientMetaToRestPayload<T extends Record<string, unknown>>(
  payload: T,
  meta: ClientEventMeta | null,
): T {
  if (!CLIENT_EVENT_META_ENABLED) return payload;
  if (!meta) return payload;
  if ('dict' in payload || 'model' in payload || 'method' in payload) {
    // RPC create_update shape — never touch.
    return payload;
  }
  return { ...payload, _client_meta: meta } as T;
}
