/**
 * Temporary fail-closed compatibility boundary until Task 7 replaces the old
 * partner screen. It cannot enqueue a generic payment or create accounting.
 * New callers use invoiceCollection.ts and invoiceCollectionSync.ts only.
 */

export type CollectPaymentPhase = 'idle' | 'done';

export type CollectPaymentOutcome =
  | { status: 'invalid'; message: string }
  | { status: 'ignored_inflight' }
  | { status: 'ignored_done' }
  | { status: 'enqueued'; operationId: string };

export interface LegacyCollectionBoundaryDeps {
  uuid: () => string;
  enqueue: (
    type: any,
    payload: Record<string, unknown>,
    opts: { operationId: string },
  ) => unknown;
}

export function createCollectPaymentController(_deps: LegacyCollectionBoundaryDeps) {
  return {
    getPhase(): CollectPaymentPhase { return 'idle'; },
    getOperationId(): string | null { return null; },
    onIntentInputsChanged(..._args: unknown[]): void {},
    submit(_input: Record<string, unknown>): CollectPaymentOutcome {
      return {
        status: 'invalid',
        message: 'La cobranza por factura requiere seleccionar una factura de la parada.',
      };
    },
    acknowledgeDone(): void {},
    reset(): void {},
  };
}
