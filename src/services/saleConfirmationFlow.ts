import { readSaleSubmissionErrorMetadata } from './saleSubmissionOutcome.ts';

export interface ResumeAfterSaleInput {
  saleConfirmed: boolean;
  hasAfterSaleAction: boolean;
  stopExists: boolean;
  saleSubmitting: boolean;
  saleRecoveryPersistenceFailed: boolean;
}

export function shouldResumeAfterSale({
  saleConfirmed,
  hasAfterSaleAction,
  stopExists,
  saleSubmitting,
  saleRecoveryPersistenceFailed,
}: ResumeAfterSaleInput): boolean {
  return saleConfirmed
    && !hasAfterSaleAction
    && stopExists
    && !saleSubmitting
    && !saleRecoveryPersistenceFailed;
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
