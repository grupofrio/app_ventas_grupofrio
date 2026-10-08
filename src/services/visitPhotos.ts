import type { SyncEnqueueOptions, SyncItemType } from '../types/sync';
import {
  evidenceTypeForImageType,
  usableCoordinates,
  type EvidencePhotoCapture,
} from './evidencePhotoSync.ts';

type EnqueuePhoto = (
  type: Extract<SyncItemType, 'photo'>,
  payload: Record<string, unknown>,
  opts?: SyncEnqueueOptions,
) => string;

export function appendVisitPhotoUri(current: string[], uri: string): string[] {
  return [...current, uri];
}

export function enqueueVisitPhotos({
  stopId,
  photoUris,
  enqueue,
  dependsOn,
  holdProcessing,
  imageType = 'visit',
  capture,
}: {
  stopId: number;
  photoUris: string[];
  enqueue: EnqueuePhoto;
  dependsOn?: string[];
  holdProcessing?: boolean;
  imageType?: string;
  capture?: EvidencePhotoCapture;
}): string[] {
  return photoUris.map((localUri) => {
    const opts: SyncEnqueueOptions | undefined = dependsOn?.length || holdProcessing
      ? {
          ...(dependsOn?.length ? { dependsOn: [...dependsOn] } : {}),
          ...(holdProcessing ? { holdProcessing } : {}),
        }
      : undefined;

    const payload: Record<string, unknown> = {
      stop_id: stopId,
      localUri,
      image_type: imageType,
      evidence_type: evidenceTypeForImageType(imageType),
    };
    const coords = usableCoordinates(capture?.latitude, capture?.longitude);
    if (coords) {
      payload.capture_latitude = coords.latitude;
      payload.capture_longitude = coords.longitude;
    }
    if (typeof capture?.capturedAt === 'string' && capture.capturedAt.trim()) {
      payload.captured_at = capture.capturedAt.trim();
    }

    return enqueue('photo', payload, opts);
  });
}
