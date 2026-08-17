import { requestFromIntent, type InvoiceCollectionIntent, type InvoiceCollectionServerResult, type InvoiceCollectionStatus } from './invoiceCollection.ts';

type PersistedStatus = Extract<InvoiceCollectionStatus, 'pending' | 'applied' | 'review_required'>;

export interface InvoiceCollectionIntentPersistence {
  list(): Promise<InvoiceCollectionIntent[]>;
  insert(intent: InvoiceCollectionIntent): Promise<void>;
  transition(operationId: string, status: PersistedStatus, nowMs: number): Promise<void>;
}

export interface InvoiceCollectionTransport {
  collect(request: ReturnType<typeof requestFromIntent>): Promise<InvoiceCollectionServerResult>;
}

export interface InvoiceCollectionSyncDeps {
  persistence: InvoiceCollectionIntentPersistence;
  transport: InvoiceCollectionTransport;
  isOnline: () => boolean;
  now: () => number;
}

export type InvoiceCollectionCaptureResult = { status: 'applied' | 'captured_pending' | 'pending' | 'review_required'; operationId: string };

function isTerminal(status: InvoiceCollectionIntent['status']): boolean {
  return status === 'applied' || status === 'review_required';
}

export function createInvoiceCollectionSyncProcessor(deps: InvoiceCollectionSyncDeps) {
  let reconciliation: Promise<void> | null = null;
  const captures = new Map<string, Promise<InvoiceCollectionCaptureResult>>();
  async function send(intent: InvoiceCollectionIntent): Promise<InvoiceCollectionCaptureResult> {
    try {
      const result = await deps.transport.collect(requestFromIntent(intent));
      const status: PersistedStatus = result.status === 'applied' ? 'applied' : 'review_required';
      // Persist acknowledgement before publishing it. A crash here only causes
      // an idempotent replay under the original UUID on restart.
      await deps.persistence.transition(intent.operation_id, status, deps.now());
      return { status, operationId: intent.operation_id };
    } catch {
      await deps.persistence.transition(intent.operation_id, 'pending', deps.now());
      return { status: 'pending', operationId: intent.operation_id };
    }
  }
  return {
    capture(intent: InvoiceCollectionIntent): Promise<InvoiceCollectionCaptureResult> {
      const inFlight = captures.get(intent.operation_id);
      if (inFlight) return inFlight;
      const capture = (async () => {
        // This awaited encrypted write is the commit point before first send.
        await deps.persistence.insert(intent);
        if (!deps.isOnline()) {
          await deps.persistence.transition(intent.operation_id, 'pending', deps.now());
          return { status: 'captured_pending' as const, operationId: intent.operation_id };
        }
        return send(intent);
      })();
      captures.set(intent.operation_id, capture);
      void capture.then(
        () => { captures.delete(intent.operation_id); },
        () => { captures.delete(intent.operation_id); },
      );
      return capture;
    },
    reconcile(): Promise<void> {
      if (reconciliation) return reconciliation;
      reconciliation = (async () => {
        if (!deps.isOnline()) return;
        for (const intent of await deps.persistence.list()) {
          if (!isTerminal(intent.status)) await send(intent);
        }
      })().finally(() => { reconciliation = null; });
      return reconciliation;
    },
  };
}
