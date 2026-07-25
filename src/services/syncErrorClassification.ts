import type { SyncItemType } from '../types/sync.ts';
import {
  describeInsufficientStock,
  getInsufficientStockDetail,
  type InsufficientStockDetail,
} from './insufficientStock.ts';
import {
  classifySaleSubmissionError,
  readSaleSubmissionErrorMetadata,
} from './saleSubmissionOutcome.ts';
import { isRetryableSyncErrorMessage } from '../utils/syncFailure.ts';

export interface SyncFailureClassification {
  retryAutomatically: boolean;
  terminalStatus: 'error' | 'dead';
  errorCode: string | null;
  protectFromGenericClear: boolean;
}

function readProperty(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function normalizedCode(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function readStructuredErrorCode(error: unknown): string | null {
  const directCode = normalizedCode(readProperty(error, 'code'));
  const data = readProperty(error, 'data');
  const dataCode = normalizedCode(readProperty(data, 'error_code'));
  return dataCode === 'insufficient_stock' ? dataCode : directCode ?? dataCode;
}

function readInsufficientStockDetail(error: unknown): InsufficientStockDetail | null {
  try {
    const direct = getInsufficientStockDetail(error);
    if (direct) return direct;
  } catch {
    // A malformed/hostile error must not break the sync processor.
  }

  const data = readProperty(error, 'data');
  if (normalizedCode(readProperty(data, 'error_code')) !== 'insufficient_stock') {
    return null;
  }

  try {
    return getInsufficientStockDetail({ code: 'insufficient_stock', data });
  } catch {
    return { lines: [] };
  }
}

export function classifySyncFailure(
  item: Pick<{ type: SyncItemType }, 'type'>,
  error: unknown,
): SyncFailureClassification {
  if (item.type === 'sale_order') {
    const saleOutcome = classifySaleSubmissionError(error);
    const metadata = readSaleSubmissionErrorMetadata(error);
    const directCode = normalizedCode(metadata.code);
    const errorName = normalizedCode(metadata.name);
    const explicitTransportAmbiguity =
      metadata.responseReceived === false
      || (metadata.httpStatus !== undefined
        && metadata.httpStatus >= 500
        && metadata.httpStatus <= 599)
      || (saleOutcome.kind === 'ambiguous_result'
        && ((directCode !== null && directCode !== 'insufficient_stock')
          || (errorName !== null && errorName !== 'error')));

    if (!explicitTransportAmbiguity && readInsufficientStockDetail(error)) {
      return {
        retryAutomatically: false,
        terminalStatus: 'dead',
        errorCode: 'insufficient_stock',
        protectFromGenericClear: true,
      };
    }

    const retryAutomatically = saleOutcome.kind === 'ambiguous_result';
    return {
      retryAutomatically,
      terminalStatus: retryAutomatically ? 'error' : 'dead',
      errorCode: retryAutomatically ? null : readStructuredErrorCode(error),
      protectFromGenericClear: false,
    };
  }

  const message = error instanceof Error ? error.message : 'Sync error';
  const retryAutomatically = isRetryableSyncErrorMessage(message);
  return {
    retryAutomatically,
    terminalStatus: retryAutomatically ? 'error' : 'dead',
    errorCode: null,
    protectFromGenericClear: false,
  };
}

export function describeSyncFailureForUser(
  error: unknown,
  classification: SyncFailureClassification,
): string {
  if (classification.errorCode === 'insufficient_stock') {
    const detail = readInsufficientStockDetail(error) ?? { lines: [] };
    return describeInsufficientStock(detail).slice(0, 500);
  }
  return classification.retryAutomatically
    ? 'No se pudo sincronizar. Se reintentará automáticamente.'
    : 'La operación fue rechazada y requiere atención.';
}
