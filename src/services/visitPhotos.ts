import type { SyncEnqueueOptions, SyncItemType } from '../types/sync';

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
}: {
  stopId: number;
  photoUris: string[];
  enqueue: EnqueuePhoto;
  dependsOn?: string[];
  holdProcessing?: boolean;
  imageType?: string;
}): string[] {
  const opts: SyncEnqueueOptions | undefined = dependsOn?.length || holdProcessing
    ? {
        ...(dependsOn?.length ? { dependsOn } : {}),
        ...(holdProcessing ? { holdProcessing } : {}),
      }
    : undefined;

  return photoUris.map((localUri) =>
    enqueue(
      'photo',
      {
        stop_id: stopId,
        localUri,
        image_type: imageType,
      },
      opts,
    )
  );
}
