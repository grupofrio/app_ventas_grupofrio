import { readSaleSubmissionErrorMetadata } from './saleSubmissionOutcome.ts';

export interface ResumeAfterSaleInput {
  saleConfirmed: boolean;
  hasAfterSaleAction: boolean;
  stopExists: boolean;
  saleSubmitting: boolean;
  saleRecoveryPersistenceFailed: boolean;
  saleReadyToContinue: boolean;
  hasQueuedSaleOrderEvidence: boolean;
}

export interface SaleRecoveryQueueEvidenceItem {
  id: string;
  type: string;
}

export function hasQueuedSaleOrderRecoveryEvidence(
  saleOperationId: string | null,
  queue: readonly SaleRecoveryQueueEvidenceItem[],
): boolean {
  if (saleOperationId === null) return false;
  return queue.some((item) => (
    item.type === 'sale_order' && item.id === saleOperationId
  ));
}

export function shouldResumeAfterSale({
  saleConfirmed,
  hasAfterSaleAction,
  stopExists,
  saleSubmitting,
  saleRecoveryPersistenceFailed,
  saleReadyToContinue,
  hasQueuedSaleOrderEvidence,
}: ResumeAfterSaleInput): boolean {
  return saleConfirmed
    && !hasAfterSaleAction
    && stopExists
    && !saleSubmitting
    && !saleRecoveryPersistenceFailed
    && (saleReadyToContinue || hasQueuedSaleOrderEvidence);
}

export interface SaleConfirmationSingleFlight {
  tryAcquire: () => boolean;
  release: () => void;
  readonly isActive: boolean;
}

export function createSaleConfirmationSingleFlight(): SaleConfirmationSingleFlight {
  let active = false;

  return {
    tryAcquire: () => {
      if (active) return false;
      active = true;
      return true;
    },
    release: () => {
      active = false;
    },
    get isActive() {
      return active;
    },
  };
}

export function safeUnknownErrorMessage(error: unknown, fallback: string): string {
  try {
    const message = readSaleSubmissionErrorMetadata(error).message;
    return typeof message === 'string' && message.trim().length > 0
      ? message
      : fallback;
  } catch {
    return fallback;
  }
}
