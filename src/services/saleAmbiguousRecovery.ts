import type { SyncEnqueueOptions, SyncItemType } from '../types/sync';
import { enqueueVisitPhotos } from './visitPhotos.ts';

type Enqueue = (
  type: SyncItemType,
  payload: Record<string, unknown>,
  opts?: SyncEnqueueOptions,
) => string;

export interface PersistAmbiguousSaleInput {
  operationId: string;
  payload: Record<string, unknown>;
  customerName: string;
  total: number;
  stopId: number;
  photoUris: string[];
  enqueue: Enqueue;
  persistQueue: () => Promise<void>;
  releaseProcessingHolds: (ids: string[]) => void;
}

export interface PersistAmbiguousSaleResult {
  saleId: string;
  photoIds: string[];
}

export async function persistAmbiguousSale({
  operationId,
  payload,
  customerName,
  total,
  stopId,
  photoUris,
  enqueue,
  persistQueue,
  releaseProcessingHolds,
}: PersistAmbiguousSaleInput): Promise<PersistAmbiguousSaleResult> {
  const heldIds: string[] = [];
  const trackedEnqueue: Enqueue = (type, enqueuedPayload, opts) => {
    const id = enqueue(type, enqueuedPayload, opts);
    heldIds.push(id);
    return id;
  };
  let result: PersistAmbiguousSaleResult;

  try {
    const saleId = trackedEnqueue(
      'sale_order',
      {
        ...payload,
        _clientCustomerName: customerName,
        _clientTotal: total,
      },
      {
        operationId,
        holdProcessing: true,
      },
    );

    if (saleId !== operationId) {
      throw new Error('La cola no conservó el identificador de la venta.');
    }

    const photoIds = enqueueVisitPhotos({
      stopId,
      photoUris,
      enqueue: trackedEnqueue,
      dependsOn: [operationId],
      holdProcessing: true,
      imageType: 'sale',
    });

    await persistQueue();
    result = { saleId, photoIds };
  } catch (error) {
    releaseProcessingHolds(heldIds);
    throw error;
  }

  releaseProcessingHolds(heldIds);
  return result;
}
