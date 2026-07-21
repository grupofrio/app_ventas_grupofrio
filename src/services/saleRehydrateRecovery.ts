import type { SyncEnqueueOptions, SyncItemType } from '../types/sync.ts';
import { persistAmbiguousSaleRecovery } from './saleAmbiguousRecovery.ts';
import type { SaleRecoveryIntentV1 } from './saleRecoveryIntent.ts';
import type { SaleTicketSnapshot } from './saleTicket.ts';

type Enqueue = (
  type: SyncItemType,
  payload: Record<string, unknown>,
  options?: SyncEnqueueOptions,
) => string;

export interface RehydrateSaleQueueItem {
  id: string;
  type: string;
  status?: string;
}

export interface RecoverPersistedSaleIntentInput {
  saleConfirmed: boolean;
  saleReadyToContinue: boolean;
  intent: SaleRecoveryIntentV1 | null;
  queue: readonly RehydrateSaleQueueItem[];
  enqueue: Enqueue;
  persistQueue: () => Promise<void>;
  releaseProcessingHolds: (ids: string[]) => void;
  saveTicket: (snapshot: SaleTicketSnapshot) => Promise<void>;
}

export interface RecoverPersistedSaleIntentResult {
  status: 'not_recoverable' | 'already_queued' | 'materialized';
}

export async function recoverPersistedSaleIntent({
  saleConfirmed,
  saleReadyToContinue,
  intent,
  queue,
  enqueue,
  persistQueue,
  releaseProcessingHolds,
  saveTicket,
}: RecoverPersistedSaleIntentInput): Promise<RecoverPersistedSaleIntentResult> {
  if (!saleConfirmed || saleReadyToContinue || intent === null) {
    return { status: 'not_recoverable' };
  }

  const alreadyQueued = queue.some((item) => (
    item.type === 'sale_order'
    && item.id === intent.operationId
    && item.status !== 'dead'
  ));

  if (!alreadyQueued) {
    await persistAmbiguousSaleRecovery({
      operationId: intent.operationId,
      payload: intent.queuePayload,
      customerName: intent.queuePayload._clientCustomerName as string,
      total: intent.queuePayload._clientTotal as number,
      stopId: intent.stopId,
      photoUris: intent.photoUris,
      enqueue,
      persistQueue,
      releaseProcessingHolds,
    });
  }

  try {
    await saveTicket(intent.ticketSnapshot);
  } catch {
    // Ticket persistence is secondary; the durable queue/intent is authoritative.
  }

  return { status: alreadyQueued ? 'already_queued' : 'materialized' };
}
