import type { SyncItemType } from '../types/sync';

type EnqueuePhoto = (
  type: Extract<SyncItemType, 'photo'>,
  payload: Record<string, unknown>,
  opts?: { dependsOn?: string[] },
) => string;

export function appendVisitPhotoUri(current: string[], uri: string): string[] {
  return [...current, uri];
}

export function enqueueVisitPhotos({
  stopId,
  photoUris,
  enqueue,
  dependsOn,
}: {
  stopId: number;
  photoUris: string[];
  enqueue: EnqueuePhoto;
  dependsOn?: string[];
}): string[] {
  return photoUris.map((localUri) =>
    enqueue(
      'photo',
      {
        stop_id: stopId,
        localUri,
        image_type: 'visit',
      },
      dependsOn && dependsOn.length > 0 ? { dependsOn } : undefined,
    )
  );
}
