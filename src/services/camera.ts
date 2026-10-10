/**
 * Camera service — photo capture with file persistence.
 *
 * Uses expo-image-picker (simpler than expo-camera, no custom view needed).
 * Photos saved to app's document directory (survives offline).
 * Only file URI is stored in sync queue (NOT base64).
 *
 * PREBUILD NOTE: expo-image-picker works in Expo Go.
 * expo-camera requires custom dev client for advanced features.
 */

import * as ImagePicker from 'expo-image-picker';
import { CAMERA_OPEN_ERROR, decideCameraPermission, isCameraOpenError, withCameraTimeout } from './cameraAccess.ts';
// expo-file-system types vary by version; use namespace import
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExpoFS = require('expo-file-system') as {
  documentDirectory: string | null;
  getInfoAsync: (uri: string, opts?: { size?: boolean }) => Promise<{ exists: boolean; size?: number; modificationTime?: number }>;
  makeDirectoryAsync: (uri: string, opts?: { intermediates?: boolean }) => Promise<void>;
  copyAsync: (opts: { from: string; to: string }) => Promise<void>;
  readAsStringAsync: (uri: string, opts?: { encoding?: string }) => Promise<string>;
  deleteAsync: (uri: string, opts?: { idempotent?: boolean }) => Promise<void>;
  readDirectoryAsync: (uri: string) => Promise<string[]>;
  EncodingType: { Base64: string };
};

const PHOTO_DIR = `${ExpoFS.documentDirectory || ''}photos/`;

// BLD-20260404-011 — Photo pipeline tuning.
//
// quality tuning:
//   - JPEG quality 0.4 = ~120-180 KB per photo on typical mid-range Android.
//   - expo-image-picker does not resize; only compresses. True resize
//     would need expo-image-manipulator (new native dep — deferred).
// soft size ceiling: we log a warning if a saved photo exceeds it, so we
//   can quantify how often resize is needed before committing to adding
//   the native dep.
// stale threshold: the cleanup helper removes photos older than this
//   that are not referenced by the current sync queue.
export const PHOTO_QUALITY = 0.4;
export const PHOTO_MAX_SOFT_BYTES = 350 * 1024; // 350 KB
export const PHOTO_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// BLD-20260404-011 — kill switches.
// Two independent flags so we can disable the risky side (the janitor)
// without losing the low-risk side (delete-after-sync). Both default ON
// because they are additive cleanups of files we already synced.
// Flip either to `false` to get the exact legacy behaviour.
export const PHOTO_DELETE_ON_SYNC_ENABLED = true;
export const PHOTO_JANITOR_ENABLED = true;

// BLD-20260404-011 — in-process counters (telemetry only, not persisted).
// Purpose: quantify how often photos exceed the soft size ceiling so we
// can decide whether it's worth introducing expo-image-manipulator. Also
// track janitor activity to spot pathological cleanup patterns.
// Reset only on app cold start or via resetPhotoCounters() in tests.
export const photoCounters = {
  capturedTotal: 0,
  oversizedTotal: 0,       // > PHOTO_MAX_SOFT_BYTES
  deletedPostSyncTotal: 0, // successful delete after sync
  deletePostSyncErrors: 0,
  janitorRuns: 0,
  janitorRemovedTotal: 0,
  janitorSkippedReferencedTotal: 0,
};

export function resetPhotoCounters(): void {
  photoCounters.capturedTotal = 0;
  photoCounters.oversizedTotal = 0;
  photoCounters.deletedPostSyncTotal = 0;
  photoCounters.deletePostSyncErrors = 0;
  photoCounters.janitorRuns = 0;
  photoCounters.janitorRemovedTotal = 0;
  photoCounters.janitorSkippedReferencedTotal = 0;
}

/**
 * Ensure photos directory exists.
 */
async function ensurePhotoDir(): Promise<void> {
  const dirInfo = await ExpoFS.getInfoAsync(PHOTO_DIR);
  if (!dirInfo.exists) {
    await ExpoFS.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
  }
}

export interface CapturedPhoto {
  localUri: string;    // file:///... path to saved photo
  width: number;
  height: number;
  timestamp: number;
}

/**
 * Request camera permission and take a photo.
 * Saves to local filesystem and returns URI.
 *
 * Returns null if:
 *   - permission denied
 *   - user cancelled
 *   - camera error
 */
export async function takePhoto(): Promise<CapturedPhoto | null> {
  try {
    const current = await withCameraTimeout(ImagePicker.getCameraPermissionsAsync());
    if (decideCameraPermission(current.status) === 'request') {
      const requested = await withCameraTimeout(ImagePicker.requestCameraPermissionsAsync());
      if (requested.status !== 'granted') {
        console.warn('[camera] Permission denied');
        return null;
      }
    }

    // BLD-20260404-011: quality tightened to 0.4 for smaller payloads.
    // Proper max-dimension resize still requires expo-image-manipulator
    // (not currently in deps — would introduce native build risk).
    const result = await withCameraTimeout(ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      quality: PHOTO_QUALITY,
      allowsEditing: false,
      exif: false,
    }));

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    const timestamp = Date.now();

    // Save to persistent directory
    await ensurePhotoDir();
    const filename = `photo_${timestamp}.jpg`;
    const destUri = `${PHOTO_DIR}${filename}`;

    await ExpoFS.copyAsync({
      from: asset.uri,
      to: destUri,
    });

    // BLD-011: measure size + increment counters; never blocks.
    photoCounters.capturedTotal += 1;
    try {
      const info = await ExpoFS.getInfoAsync(destUri, { size: true });
      if (info.exists && typeof info.size === 'number' && info.size > PHOTO_MAX_SOFT_BYTES) {
        photoCounters.oversizedTotal += 1;
        console.warn(
          `[camera] Photo ${filename} exceeds soft ceiling: ` +
          `${Math.round(info.size / 1024)}KB > ${Math.round(PHOTO_MAX_SOFT_BYTES / 1024)}KB ` +
          `(oversized=${photoCounters.oversizedTotal}/${photoCounters.capturedTotal})`,
        );
      }
    } catch {
      // size check is purely telemetry — never blocks
    }

    return {
      localUri: destUri,
      width: asset.width,
      height: asset.height,
      timestamp,
    };
  } catch (error) {
    if (isCameraOpenError(error)) {
      throw error;
    }
    console.error('[camera] Error:', error);
    return null;
  }
}

/**
 * Read a photo as base64 (only for upload to server).
 * NOT for storing in queue — use localUri instead.
 */
export async function readPhotoAsBase64(localUri: string): Promise<string | null> {
  try {
    const base64 = await ExpoFS.readAsStringAsync(localUri, {
      encoding: ExpoFS.EncodingType.Base64,
    });
    return base64;
  } catch {
    return null;
  }
}

/**
 * Delete a photo from local storage.
 */
export async function deletePhoto(localUri: string): Promise<void> {
  try {
    await ExpoFS.deleteAsync(localUri, { idempotent: true });
  } catch {
    // Ignore
  }
}

/**
 * Check camera permission status without requesting.
 */
export async function getCameraPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await ImagePicker.getCameraPermissionsAsync();
  return status;
}

// ═══ BLD-20260404-011 — Photo pipeline janitor ═══

/**
 * Returns the full list of URIs currently stored in the photos dir.
 * Safe: returns [] if the dir doesn't exist yet.
 */
export async function listStoredPhotos(): Promise<string[]> {
  try {
    const dirInfo = await ExpoFS.getInfoAsync(PHOTO_DIR);
    if (!dirInfo.exists) return [];
    const entries = await ExpoFS.readDirectoryAsync(PHOTO_DIR);
    return entries.map((name) => `${PHOTO_DIR}${name}`);
  } catch (error) {
    if (__DEV__) console.warn('[camera] listStoredPhotos failed:', error);
    return [];
  }
}

/**
 * Return size (bytes) + mtime for a single stored photo, or null.
 */
async function statPhoto(uri: string): Promise<{ size: number; mtime: number } | null> {
  try {
    const info = await ExpoFS.getInfoAsync(uri, { size: true });
    if (!info.exists) return null;
    return {
      size: typeof info.size === 'number' ? info.size : 0,
      mtime: typeof info.modificationTime === 'number'
        ? info.modificationTime * 1000
        : Date.now(),
    };
  } catch {
    return null;
  }
}

export interface PhotoCleanupReport {
  scanned: number;
  removed: number;
  skippedReferenced: number;
  freedBytes: number;
  errors: number;
}

/**
 * Remove photos that are BOTH:
 *   - older than `PHOTO_STALE_MS` (default 7 days)
 *   - not referenced by any `referencedUris` passed in by the caller
 *
 * The caller is expected to pass the set of localUris currently present
 * in the sync queue (pending/error items). This is an opt-in janitor —
 * it is only invoked explicitly from the sync store after a successful
 * drain, never on a hot path and never without an explicit referenced
 * list.
 *
 * Rules:
 *   - If `referencedUris` is empty, the function will STILL refuse to
 *     delete photos newer than `PHOTO_STALE_MS`.
 *   - Any IO failure is logged and counted but never thrown.
 *   - Returns a report so the caller can log it.
 */
export async function cleanupOrphanPhotos(
  referencedUris: Set<string>,
): Promise<PhotoCleanupReport> {
  const report: PhotoCleanupReport = {
    scanned: 0,
    removed: 0,
    skippedReferenced: 0,
    freedBytes: 0,
    errors: 0,
  };
  // BLD-011 kill switch: janitor disabled → no-op, return empty report.
  if (!PHOTO_JANITOR_ENABLED) {
    if (__DEV__) console.log('[camera] janitor disabled by flag');
    return report;
  }
  photoCounters.janitorRuns += 1;
  const now = Date.now();
  let stored: string[] = [];
  try {
    stored = await listStoredPhotos();
  } catch {
    report.errors += 1;
    return report;
  }

  for (const uri of stored) {
    report.scanned += 1;
    // HARD GUARANTEE: a photo referenced by any pending/error op in the
    // queue is NEVER deleted by the janitor, regardless of age.
    if (referencedUris.has(uri)) {
      report.skippedReferenced += 1;
      continue;
    }
    const stat = await statPhoto(uri);
    if (!stat) {
      report.errors += 1;
      continue;
    }
    const age = now - stat.mtime;
    if (age < PHOTO_STALE_MS) {
      // Young, not referenced — keep. Might become referenced soon or
      // might belong to a UI path we don't know about.
      continue;
    }
    try {
      await ExpoFS.deleteAsync(uri, { idempotent: true });
      report.removed += 1;
      report.freedBytes += stat.size;
    } catch {
      report.errors += 1;
    }
  }
  photoCounters.janitorRemovedTotal += report.removed;
  photoCounters.janitorSkippedReferencedTotal += report.skippedReferenced;
  if (__DEV__) {
    console.log(
      `[camera] cleanup: scanned=${report.scanned} removed=${report.removed} ` +
      `skipped=${report.skippedReferenced} freed=${Math.round(report.freedBytes / 1024)}KB ` +
      `errors=${report.errors}`,
    );
  }
  return report;
}
