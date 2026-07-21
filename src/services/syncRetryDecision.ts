import type { SyncItemType } from '../types/sync.ts';
import { classifySaleSubmissionError } from './saleSubmissionOutcome.ts';
import { isRetryableSyncErrorMessage } from '../utils/syncFailure.ts';

export function shouldRetrySyncItemError(type: SyncItemType, error: unknown): boolean {
  if (type === 'sale_order') {
    return classifySaleSubmissionError(error).kind === 'ambiguous_result';
  }
  const message = error instanceof Error ? error.message : 'Sync error';
  return isRetryableSyncErrorMessage(message);
}
