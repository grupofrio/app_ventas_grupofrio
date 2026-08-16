/**
 * Collect payment intent — single-flight + stable operation_id (FE-1).
 *
 * Tap Cobrar → mint ONE UUID v4 intent.
 * Double tap / submit while in-flight → ignored.
 * Retry after failure → SAME operation_id.
 * Amount/partner change → new intent (different commercial meaning).
 */

export type CollectPaymentPhase = 'idle' | 'submitting' | 'done';

export interface CollectPaymentInput {
  partnerId: number;
  amount: number;
  journalId: number | null | undefined;
  paymentMethod: string;
  reference?: string;
}

export interface CollectPaymentEnqueueResult {
  id: string;
}

export interface CollectPaymentDeps {
  uuid: () => string;
  enqueue: (
    type: 'payment',
    payload: Record<string, unknown>,
    opts: { operationId: string },
  ) => CollectPaymentEnqueueResult | string;
}

export type CollectPaymentOutcome =
  | { status: 'invalid'; message: string }
  | { status: 'ignored_inflight' }
  | { status: 'ignored_done' }
  | { status: 'enqueued'; operationId: string };

export function createCollectPaymentController(deps: CollectPaymentDeps) {
  let phase: CollectPaymentPhase = 'idle';
  let operationId: string | null = null;
  let boundPartnerId: number | null = null;
  let boundAmount: number | null = null;

  function resetIntent() {
    operationId = null;
    boundPartnerId = null;
    boundAmount = null;
    if (phase !== 'submitting') phase = 'idle';
  }

  return {
    getPhase(): CollectPaymentPhase {
      return phase;
    },
    getOperationId(): string | null {
      return operationId;
    },
    /** Call when partner/amount changes so a new commercial intent gets a new id. */
    onIntentInputsChanged(partnerId: number, amount: number) {
      if (boundPartnerId === partnerId && boundAmount === amount) return;
      if (phase === 'submitting') return;
      resetIntent();
      phase = 'idle';
    },
    submit(input: CollectPaymentInput): CollectPaymentOutcome {
      if (phase === 'submitting') return { status: 'ignored_inflight' };
      if (phase === 'done') return { status: 'ignored_done' };

      const amount = input.amount;
      if (!Number.isFinite(amount) || amount <= 0) {
        return { status: 'invalid', message: 'Ingresa un monto valido' };
      }
      if (!Number.isFinite(input.partnerId) || input.partnerId <= 0) {
        return { status: 'invalid', message: 'Partner invalido' };
      }

      if (
        operationId
        && (boundPartnerId !== input.partnerId || boundAmount !== amount)
      ) {
        // Defensive: inputs drifted without onIntentInputsChanged.
        operationId = null;
      }

      if (!operationId) {
        operationId = deps.uuid();
        boundPartnerId = input.partnerId;
        boundAmount = amount;
      }

      phase = 'submitting';
      try {
        const payload: Record<string, unknown> = {
          partner_id: input.partnerId,
          amount,
          journal_id: input.journalId,
          reference: input.reference ?? 'Cobro visita',
          payment_method: input.paymentMethod,
          operation_id: operationId,
        };
        const result = deps.enqueue('payment', payload, { operationId });
        const id = typeof result === 'string' ? result : result.id;
        if (id !== operationId) {
          // Queue reused a different id — treat as hard failure for safety.
          phase = 'idle';
          return { status: 'invalid', message: 'Conflicto de operation_id' };
        }
        phase = 'done';
        return { status: 'enqueued', operationId };
      } catch (err) {
        // Keep operationId for retry; unlock UI.
        phase = 'idle';
        throw err;
      }
    },
    /** After user confirms success UI / navigates away. */
    acknowledgeDone() {
      phase = 'done';
    },
    /** Allow a fresh intent (e.g. new collect on same screen after success navigation cancelled). */
    reset() {
      phase = 'idle';
      resetIntent();
    },
  };
}
