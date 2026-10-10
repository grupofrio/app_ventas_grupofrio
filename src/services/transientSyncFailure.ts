/**
 * F44 — transient sync failures never become terminal.
 *
 * HTTP 5xx, 408, 429, timeouts and transport errors are retried with the
 * same queue id / operation_id until the server accepts them or a real 4xx
 * business rejection arrives. GPS stays on its own short drop path.
 */

import type { SyncQueueItem } from '../types/sync.ts';
import { isRetryableSyncErrorMessage } from '../utils/syncFailure.ts';
import { MANUAL_RECONCILIATION_REQUIRED_MESSAGE } from './syncRetryDecision.ts';
import { isProtectedPhysicalReviewItem } from './consignmentPhysicalReview.ts';

/** Cap for automatic backoff. Earlier slots stay short; the last slot is 5 min. */
export const TRANSIENT_BACKOFF_CAP_MS = 5 * 60 * 1000;

export const TRANSIENT_BACKOFF_SCHEDULE_MS = [2000, 8000, 30000, 120_000, TRANSIENT_BACKOFF_CAP_MS];

const BACKOFF_JITTER = 0.2;

const EXTRA_TRANSIENT_MESSAGE_PATTERNS = [
  /\bhttp\s*408\b/i,
  /\bhttp\s*429\b/i,
  /\b408\b/,
  /\b429\b/,
  /request timeout/i,
  /too many requests/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway time-?out/i,
  /servicio no disponible/i,
  /tiempo de espera agotado/i,
  /sin conexi[oó]n/i,
  /no hay conexi[oó]n/i,
  /\b(ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH)\b/,
  /socket hang up/i,
  /\bstatus(?:\s+code)?\s*[:=]?\s*(?:408|429|5\d\d)\b/i,
];

const DEFINITIVE_MESSAGE_PATTERNS = [
  /^http\s*4(?!08\b|29\b)\d\d\b/i,
  /\binsufficient_stock\b/i,
  /\bvalidation_error\b/i,
  /\baccess_denied\b/i,
  /\bsession_expired\b/i,
  /sesi[oó]n expirada/i,
  /fuera de radio/i,
];

function readNumber(error: object, key: string): number | undefined {
  try {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function readBoolean(error: object, key: string): boolean | undefined {
  try {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === 'boolean' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function readSyncFailureMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    try {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    } catch {
      return '';
    }
  }
  return '';
}

export function readSyncFailureHttpStatus(error: unknown): number | undefined {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return undefined;
  return readNumber(error, 'httpStatus');
}

/** 5xx, 408 and 429 are transport/availability, not a business rejection. */
export function isTransientHttpStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  if (status === 408 || status === 429) return true;
  return status >= 500 && status <= 599;
}

/** Other 4xx responses are the only automatic path to `dead`. */
export function isDefinitiveHttpStatus(status: number | undefined): boolean {
  if (status === undefined || isTransientHttpStatus(status)) return false;
  return status >= 400 && status <= 499;
}

export function isTransientFailureMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  const normalized = message.trim();
  if (!normalized) return false;
  if (DEFINITIVE_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (isRetryableSyncErrorMessage(normalized)) return true;
  return EXTRA_TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * True when this attempt must stay on the queue. A live error prefers
 * `httpStatus` / `responseReceived` over the human message, because Odoo
 * often returns a 503 body that does not start with "HTTP 503".
 */
export function isTransientSyncFailure(error: unknown): boolean {
  const status = readSyncFailureHttpStatus(error);
  if (isTransientHttpStatus(status)) return true;
  if (isDefinitiveHttpStatus(status)) return false;
  if (error && (typeof error === 'object' || typeof error === 'function')) {
    if (readBoolean(error, 'responseReceived') === false) return true;
  }
  return isTransientFailureMessage(readSyncFailureMessage(error));
}

export type BusinessFailureDisposition = 'retry' | 'dead';

/**
 * GPS keeps its attempt ceiling. Every other type retries a transient failure
 * forever; a non-retryable or exhausted non-transient failure is dead.
 */
export function decideBusinessFailureDisposition(input: {
  type: string;
  error: unknown;
  retriesAfterAttempt: number;
  attemptLimit: number;
  shouldRetry: boolean;
}): BusinessFailureDisposition {
  if (input.type !== 'gps' && isTransientSyncFailure(input.error)) return 'retry';
  if (!input.shouldRetry || input.retriesAfterAttempt >= input.attemptLimit) return 'dead';
  return 'retry';
}

export function transientBackoffMs(
  retryCount: number,
  random: () => number = Math.random,
): number {
  const index = Math.min(
    Math.max(0, retryCount),
    TRANSIENT_BACKOFF_SCHEDULE_MS.length - 1,
  );
  const base = TRANSIENT_BACKOFF_SCHEDULE_MS[index];
  const jitter = base * BACKOFF_JITTER * (random() * 2 - 1);
  return Math.min(TRANSIENT_BACKOFF_CAP_MS, Math.max(0, Math.round(base + jitter)));
}

function isDependencyBlockedMessage(message: string | null): boolean {
  if (!message) return false;
  return /depende de una operaci[oó]n que fall/i.test(message)
    || /foto no enviada porque la venta fall/i.test(message)
    || /no enviada: depende de/i.test(message);
}

/**
 * Startup migration: a prospect (or any business op) that was marked dead
 * during a 5xx/network window goes back to pending with the same id.
 * Real 4xx rejections, dependency cascades, GPS and physical-review rows stay.
 */
export function reviveTransientDeadItems(
  queue: SyncQueueItem[],
): { queue: SyncQueueItem[]; revivedIds: string[] } {
  const revivedIds: string[] = [];
  const next = queue.map((item) => {
    if (item.status !== 'dead' || item.type === 'gps') return item;
    if (isProtectedPhysicalReviewItem(item)) return item;
    if (item.error_message === MANUAL_RECONCILIATION_REQUIRED_MESSAGE) return item;
    if (isDependencyBlockedMessage(item.error_message)) return item;
    if (!isTransientFailureMessage(item.error_message)) return item;
    revivedIds.push(item.id);
    return {
      ...item,
      status: 'pending' as const,
      error_message: null,
      next_retry_at: null,
    };
  });
  return { queue: revivedIds.length > 0 ? next : queue, revivedIds };
}
