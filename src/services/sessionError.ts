/**
 * Session-expired detection (P1). Pure, testable.
 *
 * Detecta si un error de API corresponde a sesión expirada / 401 para que la UI
 * ofrezca "Volver a iniciar sesión" en vez de dejar al vendedor atrapado.
 *
 * Funciona con:
 *   - el `code: 'session_expired'` que adjunta apiResult en 401 (hardening P0),
 *   - o un mensaje que mencione 401 / sesión expirada (fallback).
 * NO hace logout aquí (eso lo decide la UI con confirmación) ni refactoriza auth.
 */

export function isSessionExpiredError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: unknown }).code;
  if (code === 'session_expired') return true;
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!message) return false;
  return /\b401\b|sesi[oó]n expirada|session expired|unauthorized/i.test(message);
}
