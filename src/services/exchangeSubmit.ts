/**
 * Pure decision for online exchange failure → enqueue vs show error vs re-login.
 * Mirrors gift policy: never enqueue without a valid session; never enqueue
 * definitive validation rejects; enqueue on retryable/ambiguous transport.
 */
export type ExchangeSubmitAction = 'enqueue' | 'show_error' | 'session_relogin';

export function decideExchangeFailureAction(input: {
  isSessionExpired: boolean;
  isRetryable: boolean;
}): ExchangeSubmitAction {
  if (input.isSessionExpired) return 'session_relogin';
  if (input.isRetryable) return 'enqueue';
  return 'show_error';
}
