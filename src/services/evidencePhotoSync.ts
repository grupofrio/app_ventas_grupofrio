/**
 * Evidence photos must reach Odoo before the stop close that would reject them.
 *
 * Checkout (and the off-route visit close) depends on the stop's photos.
 * A photo that keeps failing must not pin the close forever: after
 * EVIDENCE_PHOTO_RELEASE_ATTEMPTS failures or EVIDENCE_PHOTO_RELEASE_MS the
 * close may proceed, and the photo keeps its own backoff until
 * PHOTO_UPLOAD_MAX_ATTEMPTS.
 */

import type { SyncQueueItem } from '../types/sync.ts';
import type { ClientEventMeta } from '../utils/clientEvent.ts';
import { isRetryableSyncErrorMessage } from '../utils/syncFailure.ts';

export const EVIDENCE_PHOTO_RELEASE_ATTEMPTS = 3;
export const EVIDENCE_PHOTO_RELEASE_MS = 10 * 60 * 1000;
/** Higher than the release threshold so the close can move while the photo retries. */
export const PHOTO_UPLOAD_MAX_ATTEMPTS = 12;

export type EvidenceType = 'facade' | 'delivery' | 'other';

const CLOSE_SYNC_TYPES = new Set<SyncQueueItem['type']>(['checkout', 'offroute_visit_close']);

export interface EvidencePhotoCapture {
  latitude?: number | null;
  longitude?: number | null;
  capturedAt?: string | null;
}

export interface EvidencePhotoReleaseFields {
  type?: string;
  status: string;
  retries?: number;
  created_at?: number;
}

export function evidenceTypeForImageType(imageType: string | null | undefined): EvidenceType {
  const normalized = (imageType ?? '').trim().toLowerCase();
  if (
    normalized === 'visit'
    || normalized === 'facade'
    || normalized === 'nosale'
    || normalized === 'no_sale'
  ) {
    return 'facade';
  }
  if (normalized === 'sale' || normalized === 'delivery') return 'delivery';
  return 'other';
}

export function coerceEvidenceType(value: unknown, imageType: string): EvidenceType {
  if (value === 'facade' || value === 'delivery' || value === 'other') return value;
  return evidenceTypeForImageType(imageType);
}

export function retryCeilingForItem(item: { type?: string }, fallbackMax: number): number {
  return item.type === 'photo' ? PHOTO_UPLOAD_MAX_ATTEMPTS : fallbackMax;
}

export function isClosedStopEvidenceError(error: unknown): boolean {
  const message = errorMessage(error);
  return /parada cerrada/i.test(message) || /modificar evidencias de una parada/i.test(message);
}

export function readHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('httpStatus' in error)) return undefined;
  const status = (error as { httpStatus?: unknown }).httpStatus;
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}

/**
 * Closed-stop, transport, and 5xx failures stay on backoff.
 * Other 4xx responses and unreadable local files still go dead.
 */
export function shouldRetryPhotoUploadError(error: unknown): boolean {
  if (isClosedStopEvidenceError(error)) return true;
  const status = readHttpStatus(error);
  if (typeof status === 'number' && status >= 500) return true;
  if (typeof status === 'number' && status >= 400 && status < 500) return false;
  return isRetryableSyncErrorMessage(errorMessage(error));
}

export function isEvidencePhotoReleased(photo: EvidencePhotoReleaseFields, now: number): boolean {
  if (photo.type !== 'photo') return false;
  if (photo.status === 'done' || photo.status === 'dead') return true;
  if ((photo.retries ?? 0) >= EVIDENCE_PHOTO_RELEASE_ATTEMPTS) return true;
  if (
    typeof photo.created_at === 'number'
    && now - photo.created_at >= EVIDENCE_PHOTO_RELEASE_MS
  ) {
    return true;
  }
  return false;
}

export function readStopId(payload: Record<string, unknown> | undefined): number | null {
  const value = payload?.stop_id;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function usableCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): { latitude: number; longitude: number } | null {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

export function buildCloseDependsOn(
  photoIds: string[],
  otherIds: Array<string | null | undefined> = [],
): string[] {
  const merged: string[] = [];
  for (const id of [...photoIds, ...otherIds]) {
    if (typeof id === 'string' && id.length > 0 && !merged.includes(id)) merged.push(id);
  }
  return merged;
}

/** Photos for this stop that must upload before the close is sent. */
export function blockingEvidencePhotoIds(
  queue: Array<Pick<SyncQueueItem, 'id' | 'type' | 'status' | 'payload' | 'retries' | 'created_at'>>,
  stopId: number,
  now: number,
): string[] {
  return queue
    .filter((item) => {
      if (item.type !== 'photo' || item.status === 'done') return false;
      if (readStopId(item.payload) !== stopId) return false;
      return !isEvidencePhotoReleased(item, now);
    })
    .map((item) => item.id);
}

function isCloseType(type: string): boolean {
  return CLOSE_SYNC_TYPES.has(type as SyncQueueItem['type']);
}

/**
 * Invert the old "photo waits for checkout" edge and attach outstanding
 * evidence photos to the close that would otherwise race ahead of them.
 * Already-correct queues are returned by the same reference.
 */
export function alignEvidencePhotosBeforeClose(
  queue: SyncQueueItem[],
  now: number,
): SyncQueueItem[] {
  const closes = queue.filter((item) => isCloseType(item.type));
  if (closes.length === 0) return queue;

  const closeIds = new Set(closes.map((item) => item.id));
  const photosByStop = new Map<number, SyncQueueItem[]>();
  for (const item of queue) {
    if (item.type !== 'photo' || item.status === 'done') continue;
    const stopId = readStopId(item.payload);
    if (stopId == null) continue;
    const list = photosByStop.get(stopId) ?? [];
    list.push(item);
    photosByStop.set(stopId, list);
  }

  const photoDeps = new Map<string, string[] | undefined>();
  for (const photo of queue) {
    if (photo.type !== 'photo' || !photo.dependsOn?.length) continue;
    const remaining = photo.dependsOn.filter((id) => !closeIds.has(id));
    if (remaining.length !== photo.dependsOn.length) {
      photoDeps.set(photo.id, remaining.length > 0 ? remaining : undefined);
    }
  }

  const closeDeps = new Map<string, string[]>();
  for (const close of closes) {
    if (close.status === 'done' || close.status === 'dead' || close.status === 'syncing') continue;
    const stopId = readStopId(close.payload);
    const fromStop = stopId == null ? [] : (photosByStop.get(stopId) ?? []);
    const fromReverse = queue.filter((item) => (
      item.type === 'photo'
      && item.status !== 'done'
      && (item.dependsOn ?? []).includes(close.id)
    ));
    const seen = new Set<string>();
    const photos: SyncQueueItem[] = [];
    for (const photo of [...fromStop, ...fromReverse]) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      photos.push(photo);
    }
    const blocking = photos.filter((photo) => !isEvidencePhotoReleased(photo, now));
    if (blocking.length === 0) continue;
    const merged = [...(close.dependsOn ?? [])];
    let added = false;
    for (const photo of blocking) {
      if (!merged.includes(photo.id)) {
        merged.push(photo.id);
        added = true;
      }
    }
    if (added) closeDeps.set(close.id, merged);
  }

  if (photoDeps.size === 0 && closeDeps.size === 0) return queue;

  return queue.map((item) => {
    if (photoDeps.has(item.id)) return { ...item, dependsOn: photoDeps.get(item.id) };
    if (closeDeps.has(item.id)) return { ...item, dependsOn: closeDeps.get(item.id) };
    return item;
  });
}

export function buildEvidenceClientMeta(input: {
  meta?: ClientEventMeta | null;
  latitude?: number | null;
  longitude?: number | null;
  capturedAt?: string | null;
}): Record<string, unknown> | null {
  const coords = usableCoordinates(input.latitude, input.longitude);
  const capturedAt = typeof input.capturedAt === 'string' && input.capturedAt.trim()
    ? input.capturedAt.trim()
    : input.meta?.x_client_event_at;
  if (!coords && !capturedAt && !input.meta) return null;

  const body: Record<string, unknown> = {};
  if (input.meta) {
    body.x_client_event_at = input.meta.x_client_event_at;
    body.x_client_event_tz = input.meta.x_client_event_tz;
    body.x_client_op_uuid = input.meta.x_client_op_uuid;
    body.x_client_device_id = input.meta.x_client_device_id;
    body.x_client_schema = input.meta.x_client_schema;
  }
  if (capturedAt) body.x_client_event_at = capturedAt;
  if (coords) {
    body.latitude = coords.latitude;
    body.longitude = coords.longitude;
  }
  return body;
}

export function buildStopImageUploadPayload(input: {
  stopId: number;
  imageBase64: string;
  imageType: string;
  evidenceType?: unknown;
  meta?: ClientEventMeta | null;
  latitude?: number | null;
  longitude?: number | null;
  capturedAt?: string | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    stop_id: input.stopId,
    image_base64: input.imageBase64,
    image_type: input.imageType,
    evidence_type: coerceEvidenceType(input.evidenceType, input.imageType),
  };
  const meta = buildEvidenceClientMeta({
    meta: input.meta,
    latitude: input.latitude,
    longitude: input.longitude,
    capturedAt: input.capturedAt,
  });
  if (meta) body._client_meta = meta;
  return body;
}

export type EvidencePhotoWarningTone = 'pending' | 'retrying' | 'failed';

export interface EvidencePhotoWarning {
  tone: EvidencePhotoWarningTone;
  badge: string;
  message: string;
  pendingCount: number;
  retryingCount: number;
  failedCount: number;
}

export function describeEvidencePhotoWarning(
  queue: Array<Pick<SyncQueueItem, 'type' | 'status' | 'payload'>>,
  stopId?: number,
): EvidencePhotoWarning | null {
  let pendingCount = 0;
  let retryingCount = 0;
  let failedCount = 0;
  for (const item of queue) {
    if (item.type !== 'photo') continue;
    if (stopId !== undefined && readStopId(item.payload) !== stopId) continue;
    if (item.status === 'pending' || item.status === 'syncing') pendingCount += 1;
    else if (item.status === 'error') retryingCount += 1;
    else if (item.status === 'dead') failedCount += 1;
  }
  if (pendingCount + retryingCount + failedCount === 0) return null;

  const tone: EvidencePhotoWarningTone = failedCount > 0
    ? 'failed'
    : retryingCount > 0
      ? 'retrying'
      : 'pending';
  return {
    tone,
    badge: evidencePhotoBadge(tone, tone === 'failed' ? failedCount : tone === 'retrying' ? retryingCount : pendingCount),
    message: evidencePhotoMessage(tone, tone === 'failed' ? failedCount : tone === 'retrying' ? retryingCount : pendingCount),
    pendingCount,
    retryingCount,
    failedCount,
  };
}

export function groupEvidencePhotoWarnings(
  queue: Array<Pick<SyncQueueItem, 'type' | 'status' | 'payload'>>,
): Map<number, EvidencePhotoWarning> {
  const stopIds = new Set<number>();
  for (const item of queue) {
    if (item.type !== 'photo') continue;
    const stopId = readStopId(item.payload);
    if (stopId != null) stopIds.add(stopId);
  }
  const grouped = new Map<number, EvidencePhotoWarning>();
  for (const stopId of stopIds) {
    const warning = describeEvidencePhotoWarning(queue, stopId);
    if (warning) grouped.set(stopId, warning);
  }
  return grouped;
}

export function deadPhotoRetryBlockReason(
  photo: Pick<SyncQueueItem, 'type' | 'status' | 'dependsOn'>,
  queue: Array<Pick<SyncQueueItem, 'id' | 'type' | 'status'>>,
): string | null {
  if (photo.type !== 'photo' || photo.status !== 'dead') {
    return 'Esta foto ya no está pendiente de reintento.';
  }
  for (const depId of photo.dependsOn ?? []) {
    const dep = queue.find((item) => item.id === depId);
    if (dep && dep.status === 'dead' && dep.type !== 'photo') {
      return 'Esta foto depende de una operación que falló. Reintenta esa operación antes de reenviar la foto.';
    }
  }
  return null;
}

export function rearmDeadEvidencePhoto(queue: SyncQueueItem[], photoId: string): SyncQueueItem[] {
  let changed = false;
  const next = queue.map((item) => {
    if (item.id !== photoId || item.type !== 'photo' || item.status !== 'dead') return item;
    changed = true;
    return {
      ...item,
      status: 'pending' as const,
      retries: 0,
      error_message: null,
      next_retry_at: null,
    };
  });
  return changed ? next : queue;
}

function evidencePhotoBadge(tone: EvidencePhotoWarningTone, count: number): string {
  if (tone === 'failed') return count === 1 ? 'Foto fallida' : 'Fotos fallidas';
  if (tone === 'retrying') return count === 1 ? 'Foto sin enviar' : 'Fotos sin enviar';
  return count === 1 ? 'Foto pendiente' : 'Fotos pendientes';
}

function evidencePhotoMessage(tone: EvidencePhotoWarningTone, count: number): string {
  if (tone === 'failed') {
    return count === 1
      ? 'Hay 1 foto de evidencia que no se pudo enviar. Ábrela en Sincronización y pulsa Reintentar.'
      : `Hay ${count} fotos de evidencia que no se pudieron enviar. Ábrelas en Sincronización y pulsa Reintentar.`;
  }
  if (tone === 'retrying') {
    return count === 1
      ? 'Hay 1 foto de evidencia que no se ha enviado. Se reintentará automáticamente.'
      : `Hay ${count} fotos de evidencia que no se han enviado. Se reintentarán automáticamente.`;
  }
  return count === 1
    ? 'Hay 1 foto de evidencia pendiente de envío. Se sube antes del check-out.'
    : `Hay ${count} fotos de evidencia pendientes de envío. Se suben antes del check-out.`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}
