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
  /**
   * Expected to be non-throwing. If cleanup fails after another failure, the
   * helper rejects with an AggregateError whose cause is the primary failure;
   * after a successful persist, its cleanup error is propagated directly.
   */
  releaseProcessingHolds: (ids: string[]) => void;
}

export interface PersistAmbiguousSaleResult {
  saleId: string;
  photoIds: string[];
}

export async function persistAmbiguousSaleRecovery({
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
  const normalizedOperationId = operationId.trim();
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
        operationId: normalizedOperationId,
        holdProcessing: true,
      },
    );

    if (saleId !== normalizedOperationId) {
      throw new Error('La cola no conservó el identificador de la venta.');
    }

    const photoIds = enqueueVisitPhotos({
      stopId,
      photoUris,
      enqueue: trackedEnqueue,
      dependsOn: [normalizedOperationId],
      holdProcessing: true,
      imageType: 'sale',
    });

    await persistQueue();
    result = { saleId: normalizedOperationId, photoIds };
  } catch (error) {
    try {
      releaseProcessingHolds(heldIds);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'No se pudieron liberar las retenciones después de otro error.',
        { cause: error },
      );
    }
    throw error;
  }

  releaseProcessingHolds(heldIds);
  return result;
}
