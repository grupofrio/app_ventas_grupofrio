/**
 * Stable conversion intent — online-only prospect → customer.
 *
 * First press mints one UUID v4 and retains it across ambiguous retries.
 * Definitive outcomes clear the pending identity.
 */

export type ConvertLeadPhase = 'idle' | 'submitting' | 'ambiguous' | 'done';

export type ConvertLeadDefinitiveOutcome =
  | 'converted'
  | 'already_converted'
  | 'review_required_duplicate'
  | 'rejected';

export interface ConvertLeadIntentInput {
  stopId: number;
  leadId: number | null;
}

export interface ConvertLeadIntentDeps {
  uuid: () => string;
}

export function createConvertLeadIntentController(deps: ConvertLeadIntentDeps) {
  let phase: ConvertLeadPhase = 'idle';
  let operationId: string | null = null;
  let boundStopId: number | null = null;
  let boundLeadId: number | null = null;

  function resetIdentity() {
    operationId = null;
    boundStopId = null;
    boundLeadId = null;
  }

  function bindMatches(input: ConvertLeadIntentInput): boolean {
    return boundStopId === input.stopId && boundLeadId === (input.leadId ?? null);
  }

  return {
    getPhase(): ConvertLeadPhase {
      return phase;
    },
    getOperationId(): string | null {
      return operationId;
    },
    /** Bind or mint operation_id for this stop/lead conversion intent. */
    begin(input: ConvertLeadIntentInput): { status: 'ok'; operationId: string } | { status: 'ignored_inflight' } {
      if (phase === 'submitting') return { status: 'ignored_inflight' };

      if (operationId && !bindMatches(input)) {
        // Different prospect → new commercial intent.
        resetIdentity();
        phase = 'idle';
      }

      if (!operationId) {
        operationId = deps.uuid();
        boundStopId = input.stopId;
        boundLeadId = input.leadId ?? null;
      }

      phase = 'submitting';
      return { status: 'ok', operationId };
    },
    /** Transport/timeout ambiguity — keep UUID, unlock UI for Reintentar. */
    markAmbiguous() {
      if (operationId) phase = 'ambiguous';
      else phase = 'idle';
    },
    /** Server definitive result — clear pending identity. */
    finalize(_outcome: ConvertLeadDefinitiveOutcome) {
      resetIdentity();
      phase = 'done';
    },
    /** After navigating away / user continues route. */
    acknowledgeDone() {
      phase = 'done';
    },
    /** Restart / new session: drop ambiguous memory; caller must refresh stop first. */
    clearForRestart() {
      resetIdentity();
      phase = 'idle';
    },
  };
}
